(function () {
    function addCryptoButton() {
      // Avoid duplicates
      if (document.getElementById("crypto-pay-btn")) return;
  
      // Find Add to Cart button (product pages)
      const addToCartBtn = document.querySelector(
        'form[action*="/cart/add"] input[type="submit"], button[name="add"]'
      );
  
      // Or find cart checkout button (cart page)
      const checkoutBtn = document.querySelector('form[action*="/checkout"] [type="submit"], .cart__checkout');
  
      const targetBtn = addToCartBtn || checkoutBtn;
      if (!targetBtn) return;
  
      // Create button
      const cryptoBtn = document.createElement("button");
      cryptoBtn.id = "crypto-pay-btn";
      cryptoBtn.type = "button";
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
  
      // Redirect to your demo flow
      cryptoBtn.addEventListener("click", function () {
        const productTitle = document.querySelector("h1")?.innerText || "Cart";
        const priceText =
          document.querySelector(".price, .product-price, .cart__subtotal")?.innerText ||
          "$0.00";
  
        const checkoutData = {
          product: productTitle,
          price: priceText,
          url: window.location.href,
        };
  
        const redirectUrl =
          "https://shopify.cryptocadet.app/crypto-demo?" +
          new URLSearchParams({ checkout: JSON.stringify(checkoutData) });
  
        window.location.href = redirectUrl;
      });
  
      // Insert below button
      targetBtn.parentNode.appendChild(cryptoBtn);
    }
  
    // Run immediately
    addCryptoButton();
  
    // Watch for theme DOM updates (Shopify themes often SPA-style load)
    new MutationObserver(addCryptoButton).observe(document.body, {
      childList: true,
      subtree: true,
    });
  
    // Retry after load
    setTimeout(addCryptoButton, 2000);
    setTimeout(addCryptoButton, 5000);
  })();
  