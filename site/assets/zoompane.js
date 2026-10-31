/* 学通 · 缩放/平移/滑动 手势器（YZoom）
   为什么单独一个文件：PDF 页图阅读器 和 相册大图 需要完全一样的手势行为
   （双指缩放、放大后拖拽、双击切档、未放大时左右滑切换、纵向滚动留给浏览器）。
   以前这类逻辑是散着写的，一处改了另一处忘改——AndroidPdfViewer 也是用一个
   独立的 DragPinchManager 统一管这件事，这里照同样的思路做。

   设计要点：
   · 只处理「两指」和「已放大后的单指」；1 倍时的纵向滑动不拦，交给外层滚动
   · 横向滑动在 1 倍时判为「切换上一张/下一张」
   · 全程用 transform，不碰布局，不触发重排
   · 上限默认 3 倍（PDF 页图是位图，再放大只是糊，还给内存添压力）
*/
(function () {
  'use strict';
  if (window.YZZoom) return;

  var MIN = 1, MAX = 3, SWIPE = 56;

  function dist(a, b) {
    var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function mid(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }

  /* opts: { max, doubleTap: 2, onSwipe(dir:1|-1), onTap, onChange(scale), fit: 'width'|'page' } */
  function attach(stage, opts) {
    if (!stage || stage.__yzZoom) return stage && stage.__yzZoom;
    opts = opts || {};
    var max = opts.max || MAX;
    var st = {
      s: 1, tx: 0, ty: 0,        /* 当前缩放与位移 */
      mode: 'none',              /* none | pinch | pan | swipe */
      d0: 0, s0: 1,              /* 双指起始距离 / 起始缩放 */
      x0: 0, y0: 0, tx0: 0, ty0: 0,
      cx: 0, cy: 0,              /* 双指中心（相对 stage） */
      lastTap: 0,
      destroyed: false
    };
    stage.__yzZoom = st;

    stage.style.touchAction = 'pan-y';   /* 纵向留给外层滚动，横向与缩放自己接管 */
    stage.style.transformOrigin = '0 0';

    function apply(anim) {
      stage.style.transition = anim ? 'transform .18s ease-out' : 'none';
      stage.style.transform = 'translate3d(' + st.tx.toFixed(1) + 'px,' + st.ty.toFixed(1) + 'px,0) scale(' + st.s.toFixed(3) + ')';
      if (typeof opts.onChange === 'function') { try { opts.onChange(st.s); } catch (e) { } }
    }
    function clamp() {
      if (st.s <= 1.001) { st.s = 1; st.tx = 0; st.ty = 0; return; }
      var r = stage.parentNode ? stage.parentNode.getBoundingClientRect() : { width: 0, height: 0 };
      var w = stage.offsetWidth || r.width, h = stage.offsetHeight || r.height;
      var ox = w * (st.s - 1), oy = h * (st.s - 1);
      if (st.tx > 0) st.tx = 0;
      if (st.tx < -ox) st.tx = -ox;
      if (st.ty > 0) st.ty = 0;
      if (st.ty < -oy) st.ty = -oy;
    }

    /* 以手指中心为锚点缩放：缩放前后该点的内容保持不动 */
    function zoomAround(targetS) {
      targetS = Math.max(MIN, Math.min(max, targetS));
      var rect = stage.getBoundingClientRect();
      var px = st.cx - rect.left, py = st.cy - rect.top;   /* 未变换时的坐标 = (px - tx)/s */
      var ox = (px - st.tx) / st.s, oy = (py - st.ty) / st.s;
      st.s = targetS;
      st.tx = px - ox * st.s;
      st.ty = py - oy * st.s;
      clamp();
    }

    function onStart(e) {
      if (st.destroyed) return;
      var t = e.touches;
      if (t.length === 2) {
        st.mode = 'pinch';
        st.d0 = dist(t[0], t[1]) || 1;
        st.s0 = st.s;
        st.x0 = st.tx; st.y0 = st.ty;
        var m = mid(t[0], t[1]);
        st.cx = m.x; st.cy = m.y;
        stage.style.transition = 'none';
      } else if (t.length === 1) {
        st.mode = st.s > 1.02 ? 'pan' : 'maybe';
        st.x0 = t[0].clientX; st.y0 = t[0].clientY;
        st.tx0 = st.tx; st.ty0 = st.ty;
        /* 双击判定 */
        var now = Date.now();
        if (now - st.lastTap < 300) {
          st.lastTap = 0;
          var want = st.s > 1.02 ? 1 : (opts.doubleTap || 2);
          var r = stage.getBoundingClientRect();
          st.cx = t[0].clientX; st.cy = t[0].clientY;
          zoomAround(want);
          if (want === 1) { st.tx = 0; st.ty = 0; }
          apply(true);
          st.mode = 'none';
          return;
        }
        st.lastTap = now;
      }
    }

    function onMove(e) {
      if (st.destroyed || st.mode === 'none') return;
      var t = e.touches;
      if (st.mode === 'pinch' && t.length === 2) {
        e.preventDefault();
        var d = dist(t[0], t[1]) || 1;
        var m = mid(t[0], t[1]);
        st.cx = m.x; st.cy = m.y;
        zoomAround(st.s0 * (d / st.d0));
        apply(false);
        return;
      }
      if (t.length === 1) {
        var dx = t[0].clientX - st.x0, dy = t[0].clientY - st.y0;
        if (st.mode === 'pan') {
          e.preventDefault();
          st.tx = st.tx0 + dx; st.ty = st.ty0 + dy;
          clamp(); apply(false);
        } else if (st.mode === 'maybe') {
          /* 先判方向：横向明显 → 滑动切图；纵向 → 放行给外层滚动 */
          if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
            st.mode = 'swipe';
            e.preventDefault();
            stage.style.transition = 'none';
            stage.style.transform = 'translate3d(' + dx.toFixed(1) + 'px,0,0)';
          } else if (Math.abs(dy) > 12) {
            st.mode = 'none';   /* 纵向：不拦，让页面滚 */
          }
        } else if (st.mode === 'swipe') {
          e.preventDefault();
          stage.style.transform = 'translate3d(' + dx.toFixed(1) + 'px,0,0)';
        }
      }
    }

    function onEnd(e) {
      if (st.destroyed) return;
      if (st.mode === 'swipe') {
        var t = e.changedTouches && e.changedTouches[0];
        var dx = t ? (t.clientX - st.x0) : 0;
        var dir = dx < -SWIPE ? 1 : (dx > SWIPE ? -1 : 0);
        stage.style.transition = 'transform .16s ease-out';
        stage.style.transform = '';
        if (dir && typeof opts.onSwipe === 'function') {
          setTimeout(function () { try { opts.onSwipe(dir); } catch (e) { } }, 80);
        }
      } else if (st.mode === 'pan' || st.mode === 'pinch') {
        if (st.s < 1.02) { st.s = 1; st.tx = 0; st.ty = 0; }
        clamp(); apply(true);
        if (st.s > 1.02) { /* 放大后不再触发点击 */ }
      } else if (st.mode === 'maybe') {
        var t2 = e.changedTouches && e.changedTouches[0];
        if (t2) {
          var mx = Math.abs(t2.clientX - st.x0), my = Math.abs(t2.clientY - st.y0);
          if (mx < 8 && my < 8 && typeof opts.onTap === 'function') {
            setTimeout(function () { try { opts.onTap(); } catch (e) { } }, 0);
          }
        }
      }
      st.mode = 'none';
    }

    stage.addEventListener('touchstart', onStart, { passive: false });
    stage.addEventListener('touchmove', onMove, { passive: false });
    stage.addEventListener('touchend', onEnd, { passive: true });
    stage.addEventListener('touchcancel', onEnd, { passive: true });

    st.reset = function () { st.s = 1; st.tx = 0; st.ty = 0; apply(true); };
    st.zoomTo = function (k, cx, cy) {
      var r = stage.getBoundingClientRect();
      st.cx = (cx == null) ? r.left + r.width / 2 : cx;
      st.cy = (cy == null) ? r.top + r.height / 2 : cy;
      zoomAround(k); apply(true);
    };
    st.scale = function () { return st.s; };
    st.destroy = function () {
      st.destroyed = true;
      stage.removeEventListener('touchstart', onStart);
      stage.removeEventListener('touchmove', onMove);
      stage.removeEventListener('touchend', onEnd);
      stage.removeEventListener('touchcancel', onEnd);
      try { stage.style.transform = ''; } catch (e) { }
      stage.__yzZoom = null;
    };
    return st;
  }

  window.YZZoom = { attach: attach };
})();
