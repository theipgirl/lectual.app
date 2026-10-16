/*
 * Lectual intake embed.
 *
 *   <script src="https://<lectual origin>/embed.js" data-intake="<slug>" async></script>
 *
 * Puts the firm's public intake (<origin>/i/<slug>/?embed=1) in an iframe right
 * after this script tag, and resizes it to the height the intake reports by
 * postMessage. That is all it does: it reads nothing from the host page, sets
 * no cookies, and loads nothing else. Which sites may show the intake is up to
 * the firm's allowed domains, enforced by the intake page's own
 * frame-ancestors header, not by this script.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script || !script.getAttribute("data-intake")) {
    var all = document.querySelectorAll("script[data-intake]:not([data-lectual-mounted])");
    script = all.length ? all[all.length - 1] : null;
  }
  if (!script || script.getAttribute("data-lectual-mounted")) return;
  script.setAttribute("data-lectual-mounted", "1");

  var slug = script.getAttribute("data-intake") || "";
  if (!/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/.test(slug)) return;

  var origin;
  try {
    origin = new URL(script.src, window.location.href).origin;
  } catch (e) {
    return;
  }

  var frame = document.createElement("iframe");
  frame.src = origin + "/i/" + slug + "/?embed=1";
  frame.title = "Intake form";
  frame.setAttribute("loading", "lazy");
  frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  frame.style.width = "100%";
  frame.style.maxWidth = "680px";
  frame.style.height = "640px";
  frame.style.border = "0";
  frame.style.display = "block";
  script.parentNode.insertBefore(frame, script.nextSibling);

  window.addEventListener("message", function (event) {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    var data = event.data;
    if (!data || data.type !== "lectual-intake:resize") return;
    var h = Number(data.height);
    if (!isFinite(h) || h < 120 || h > 20000) return;
    frame.style.height = Math.ceil(h) + "px";
  });
})();
