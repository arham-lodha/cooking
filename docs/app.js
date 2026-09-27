(function () {
  'use strict';

  function storageKey(key) {
    return 'cooking-check:' + key;
  }

  document.querySelectorAll('input[type="checkbox"][data-key]').forEach(function (box) {
    var key = storageKey(box.getAttribute('data-key'));
    try {
      var saved = localStorage.getItem(key);
      if (saved !== null) box.checked = saved === '1';
    } catch (e) {
      /* localStorage unavailable (private mode, etc.) — checkbox still works, just won't persist */
    }

    box.addEventListener('change', function () {
      try {
        localStorage.setItem(key, box.checked ? '1' : '0');
      } catch (e) {
        /* ignore */
      }
    });
  });
})();
