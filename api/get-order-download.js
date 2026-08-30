<div id="kf-order-download" style="font-family:Arial,sans-serif; max-width:480px; margin:40px auto;">Loading your download&#8230;</div>
<script>
(function () {
  var orderId = window.location.pathname.split('/').pop();
  fetch('https://rockosky.vercel.app/api/get-order-download?orderId=' + encodeURIComponent(orderId))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var el = document.getElementById('kf-order-download');
      if (!data.ok || !data.items || !data.items.length) {
        el.textContent = data.error || "We couldn't find that order.";
        return;
      }
      el.innerHTML = data.items.map(function (item) {
        return item.ready
          ? '<div style="margin-bottom:20px;"><div style="margin-bottom:8px;">' + item.title + '</div>' +
            '<a href="' + item.downloadUrl + '" style="display:inline-block;background:#e2231a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:999px;font-size:12px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;">Download Full-Resolution File (No Watermark)</a></div>'
          : '<div style="margin-bottom:20px;color:#888;">' + item.title + ' — not ready for delivery yet, we’ll follow up separately.</div>';
      }).join('');
    })
    .catch(function () {
      document.getElementById('kf-order-download').textContent = 'Something went wrong loading your download. Try refreshing, or contact us.';
    });
})();
</script>
