(function () {
    function addCryptoButton() {
      // Prevent duplicates
      if (document.getElementById("crypto-pay-btn")) return;
  
      // Look for the Add to Cart button
      const addToCartBtn = document.querySelector(
        'form[action*="/cart/add"] input[type="submit"], button[name="add"]'
      );
      if (!addToCartBtn) return;
  
      // Create the Crypto button
      const cryptoBtn = document.createElement("button");
      cryptoBtn.id = "crypto-pay-btn";
      cryptoBtn.textContent = "🚀 Pay with Crypto";
      cryptoBtn.style.cssText = `
        display: block;
        margin-top: 12px;
        padding: 12px 20px;
        background: #5c6ac4;
        color: #fff;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 16px;
        font-weight: 500;
      `;
  
      // Handle click → redirect to demo checkout
      cryptoBtn.onclick = function (e) {
        e.preventDefault();
  
        const productTitle = document.querySelector("h1")?.innerText || "Product";
        const priceText =
          document.querySelector(".price, .product-price")?.innerText || "$0.00";
  
        const checkoutData = {
          product: productTitle,
          price: priceText,
          url: window.location.href,
        };
  
        const redirectUrl =
          "https://shopify.cryptocadet.app/crypto-demo?" +
          new URLSearchParams({ checkout: JSON.stringify(checkoutData) });
  
        window.location.href = redirectUrl;
      };
  
      // Insert after Add to Cart
      addToCartBtn.parentNode.appendChild(cryptoBtn);
    }
  
    // Run immediately
    addCryptoButton();
  
    // Re-run if DOM changes (SPA theme support)
    new MutationObserver(addCryptoButton).observe(document.body, {
      childList: true,
      subtree: true,
    });
  
    // Safety fallback
    setTimeout(addCryptoButton, 2000);
    setTimeout(addCryptoButton, 5000);
  })();
  