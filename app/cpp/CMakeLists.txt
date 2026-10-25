cmake_minimum_required(VERSION 3.22)
project(llama_jni CXX C)

# ---------------------------------------------------------------------
# 依赖：llama.cpp 源码放在 cpp/llama.cpp/
#   git clone --depth 1 https://github.com/ggml-org/llama.cpp cpp/llama.cpp
#
# 编译（需 Android NDK）：
#   cmake -B build-android \
#     -DCMAKE_TOOLCHAIN_FILE=$NDK/build/cmake/android.toolchain.cmake \
#     -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-29 \
#     -DGGML_OPENMP=OFF -DCMAKE_BUILD_TYPE=Release
#   cmake --build build-android -j$(nproc)
# ---------------------------------------------------------------------

set(LLAMA_DIR ${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp)
if(NOT EXISTS ${LLAMA_DIR}/CMakeLists.txt)
    message(FATAL_ERROR "找不到 llama.cpp 源码，请先执行：git clone --depth 1 https://github.com/ggml-org/llama.cpp ${LLAMA_DIR}")
endif()

# 只编译 CPU 后端，关闭 OpenMP（Android 上不稳定）
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER   OFF CACHE BOOL "" FORCE)
add_subdirectory(${LLAMA_DIR} ${CMAKE_CURRENT_BINARY_DIR}/llama_build)

add_library(llama_jni SHARED llama_jni.cpp)

target_include_directories(llama_jni PRIVATE
    ${LLAMA_DIR}/include
    ${LLAMA_DIR}/ggml/include
)

target_link_libraries(llama_jni
    llama
    ggml
    android
    log
)

target_compile_options(llama_jni PRIVATE -O3 -fvisibility=hidden)
target_link_options(llama_jni PRIVATE -Wl,--gc-sections)
