(function () {
    const urlParams = new URLSearchParams(window.location.search);
    const shop = urlParams.get('shop');
  
    if (!shop) {
      console.error('Missing shop param');
      return;
    }
  
    // Use global AppBridge object (from unpkg script)
    const AppBridge = window['app-bridge'];
    const createApp = AppBridge.createApp;
  
    const app = createApp({
      apiKey: window.SHOPIFY_API_KEY || '',
      shopOrigin: shop,
      forceRedirect: true,
    });
  
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
              '<p class="success">✅ Crypto payment method activated!</p>';
          } else {
            statusDiv.innerHTML = `<p style="color:red;">❌ Failed: ${
              data.error || 'Unknown'
            }</p>`;
          }
        } catch (err) {
          statusDiv.innerHTML = `<p style="color:red;">❌ Error: ${err.message}</p>`;
        }
      });
    }
  })();
  