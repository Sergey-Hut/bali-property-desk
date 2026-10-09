/* Web analytics. Written by tools/build.py from site.config.json. Do not edit by hand. */
(function (w, d) {
  var GA4 = "G-T45GT87X8H";
  var METRIKA = 113574723;
  w.dataLayer = w.dataLayer || [];
  if (GA4) {
    w.gtag = function () { w.dataLayer.push(arguments); };
    w.gtag('js', new Date());
    w.gtag('config', GA4);
    var g = d.createElement('script');
    g.async = true;
    g.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4;
    d.head.appendChild(g);
  }
  if (METRIKA) {
    w.ym = w.ym || function () { (w.ym.a = w.ym.a || []).push(arguments); };
    w.ym.l = +new Date();
    var y = d.createElement('script');
    y.async = true;
    y.src = 'https://mc.yandex.ru/metrika/tag.js';
    d.head.appendChild(y);
    w.ym(METRIKA, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: true });
  }
  // Called by app.js for each funnel event. page_view is counted by the tags themselves.
  w.bpdAnalytics = function (name, params) {
    if (GA4 && w.gtag) w.gtag('event', name, params || {});
    if (METRIKA && w.ym) w.ym(METRIKA, 'reachGoal', name, params || {});
  };
})(window, document);
