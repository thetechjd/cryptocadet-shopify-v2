// /public/app.js

const createApp = require('@shopify/app-bridge');

(function () {
  // Get shop param from query string
  const urlParams = new URLSearchParams(window.location.search);
  const shop = urlParams.get('shop');

  if (!shop) {
    console.error('Missing shop param in URL');
    return;
  }

  // Initialize Shopify App Bridge
  const app = createApp({
    apiKey: window.SHOPIFY_API_KEY || '', // inject via backend if needed
    shopOrigin: shop,
    forceRedirect: true,
  });

  // Handle Activate button
  const activateBtn = document.getElementById('activate-btn');
  const statusDiv = document.getElementById('activation-status');

  if (activateBtn) {
    activateBtn.addEventListener('click', async () => {
      statusDiv.innerHTML = '<p>Activating...</p>';

      try {
        const response = await fetch('/activate-payment-method', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shop }),
        });

        const data = await response.json();

        if (data.success) {
          statusDiv.innerHTML =
            '<p class="success">✅ Crypto payment method activated successfully!</p>';
        } else {
          statusDiv.innerHTML = `<p style="color:red;">❌ Activation failed: ${
            data.error || 'Unknown error'
          }</p>`;
        }
      } catch (err) {
        console.error('Activation error:', err);
        statusDiv.innerHTML = `<p style="color:red;">❌ Error: ${err.message}</p>`;
      }
    });
  }
})();
