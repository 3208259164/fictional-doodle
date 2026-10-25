/*
 * 学通 · llama.cpp JNI 封装
 * ---------------------------------------------------------------------
 * 只暴露三个方法给 Java：
 *   nativeInit(path, threads, ctxSize) -> handle（0 表示失败）
 *   nativeGenerate(handle, prompt, maxTokens) -> 生成的文本
 *   nativeFree(handle)
 *
 * 设计取舍：
 *   · 不做流式回调：WebView 的 JS 线程承受不了高频回调，改成 Java 侧轮询
 *   · 上下文固定大小：手机上 2048 够用，开大了直接 OOM
 *   · 加载失败一律返回 0 / 空串，不抛异常——网页层会自动降级
 */
#include <jni.h>
#include <string>
#include <vector>
#include <mutex>
#include <android/log.h>

#include "llama.h"

#define TAG "LlamaJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

struct Engine {
    llama_model   *model = nullptr;
    llama_context *ctx   = nullptr;
    int n_threads = 4;
    int n_ctx     = 2048;
    std::mutex mu;
};

static std::string jstr(JNIEnv *env, jstring s) {
    if (!s) return std::string();
    const char *c = env->GetStringUTFChars(s, nullptr);
    std::string out(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return out;
}

static jstring toJstr(JNIEnv *env, const std::string &s) {
    return env->NewStringUTF(s.c_str());
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_yuanziyuan_app_LlamaBridge_nativeInit(JNIEnv *env, jclass, jstring jpath, jint threads, jint ctxSize) {
    std::string path = jstr(env, jpath);
    if (path.empty()) return 0;

    try {
        llama_backend_init();

        llama_model_params mp = llama_model_default_params();
        mp.n_gpu_layers = 0;              /* 纯 CPU，避免各机型 GPU 后端差异 */
        mp.use_mmap     = true;           /* mmap 加载，不整块读进内存 */

        llama_model *model = llama_load_model_from_file(path.c_str(), mp);
        if (!model) { LOGE("load model failed: %s", path.c_str()); return 0; }

        llama_context_params cp = llama_context_default_params();
        cp.n_ctx     = ctxSize > 0 ? ctxSize : 2048;
        cp.n_batch   = 128;
        cp.n_threads = threads > 0 ? threads : 4;

        llama_context *ctx = llama_new_context_with_model(model, cp);
        if (!ctx) {
            LOGE("create context failed");
            llama_free_model(model);
            return 0;
        }

        Engine *e = new Engine();
        e->model     = model;
        e->ctx       = ctx;
        e->n_threads = cp.n_threads;
        e->n_ctx     = cp.n_ctx;

        LOGI("model loaded: %s (ctx=%d, threads=%d)", path.c_str(), cp.n_ctx, cp.n_threads);
        return reinterpret_cast<jlong>(e);
    } catch (...) {
        LOGE("nativeInit exception");
        return 0;
    }
}

extern "C" JNIEXPORT void JNICALL
Java_com_yuanziyuan_app_LlamaBridge_nativeFree(JNIEnv *, jclass, jlong handle) {
    Engine *e = reinterpret_cast<Engine *>(handle);
    if (!e) return;
    std::lock_guard<std::mutex> lk(e->mu);
    if (e->ctx)   llama_free(e->ctx);
    if (e->model) llama_free_model(e->model);
    delete e;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_yuanziyuan_app_LlamaBridge_nativeGenerate(JNIEnv *env, jclass, jlong handle, jstring jprompt, jint maxTokens) {
    Engine *e = reinterpret_cast<Engine *>(handle);
    if (!e || !e->ctx) return toJstr(env, "");

    std::string prompt = jstr(env, jprompt);
    if (prompt.empty()) return toJstr(env, "");

    std::lock_guard<std::mutex> lk(e->mu);

    try {
        /* 1. 分词 */
        std::vector<llama_token> tokens = llama_tokenize(
            e->model, prompt.c_str(), (int) prompt.size(), true, true);
        if (tokens.empty()) return toJstr(env, "");

        /* 截断到上下文的一半，给生成留空间 */
        int maxIn = e->n_ctx / 2;
        if ((int) tokens.size() > maxIn) tokens.resize(maxIn);

        /* 2. 前向：一次性喂入 prompt */
        llama_batch batch = llama_batch_init((int) tokens.size(), 0, 1);
        for (size_t i = 0; i < tokens.size(); i++) {
            batch.token[batch.n_tokens]    = tokens[i];
            batch.pos[batch.n_tokens]      = (int) i;
            batch.n_seq_id[batch.n_tokens] = 1;
            batch.seq_id[batch.n_tokens][0] = 0;
            batch.logits[batch.n_tokens]   = (i == tokens.size() - 1) ? 1 : 0;
            batch.n_tokens++;
        }
        if (llama_decode(e->ctx, batch) != 0) {
            llama_batch_free(batch);
            LOGE("decode failed");
            return toJstr(env, "");
        }
        llama_batch_free(batch);

        /* 3. 采样：贪心 + 重复惩罚，减少胡说 */
        llama_sampler_chain_params sp = llama_sampler_chain_default_params();
        llama_sampler *smpl = llama_sampler_chain_init(sp);
        llama_sampler_chain_add(smpl, llama_sampler_init_penalties(128, 1.15f, 0.0f, 0.0f));
        llama_sampler_chain_add(smpl, llama_sampler_init_greedy());

        std::string out;
        int nMax = maxTokens > 0 ? maxTokens : 256;
        int nCur = (int) tokens.size();
        int nDecoded = 0;

        for (int i = 0; i < nMax && nCur < e->n_ctx; i++) {
            llama_token id = llama_sampler_sample(smpl, e->ctx, -1);
            if (llama_token_is_eog(e->model, id)) break;

            char buf[256];
            int n = llama_token_to_piece(e->model, id, buf, sizeof(buf), 0, true);
            if (n > 0) out.append(buf, n);

            /* 单步解码 */
            llama_batch b1 = llama_batch_init(1, 0, 1);
            b1.token[0]        = id;
            b1.pos[0]          = nCur;
            b1.n_seq_id[0]     = 1;
            b1.seq_id[0][0]    = 0;
            b1.logits[0]       = 1;
            b1.n_tokens        = 1;
            int rc = llama_decode(e->ctx, b1);
            llama_batch_free(b1);
            if (rc != 0) break;

            nCur++;
            nDecoded++;
        }

        llama_sampler_free(smpl);
        LOGI("generated %d tokens, %zu chars", nDecoded, out.size());
        return toJstr(env, out);

    } catch (...) {
        LOGE("nativeGenerate exception");
        return toJstr(env, "");
    }
}
