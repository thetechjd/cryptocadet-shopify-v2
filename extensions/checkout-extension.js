(function () {
    function addCryptoButton() {
      // Avoid duplicates
      if (document.getElementById("crypto-pay-btn")) return;
  
      let targetBtn = null;
      let insertionPoint = null;

      // Check if we're on a checkout page
      if (window.location.pathname.includes('/checkout') || 
          window.location.pathname.includes('/checkouts/') || 
          window.location.search.includes('checkout')) {
        
        console.log('CryptoCadet: On checkout page');
        
        // Try multiple selectors for payment section
        const selectors = [
          '.payment-methods',
          '[data-step="payment_method"]',
          '.section--payment-method',
          '[data-payment-form]',
          '.payment-method-list',
          'form[data-payment-form]',
          '.payment-due-label',
          '.payment-due',
          '.step__footer'
        ];
        
        let paymentSection = null;
        for (const selector of selectors) {
          paymentSection = document.querySelector(selector);
          if (paymentSection) {
            console.log('CryptoCadet: Found payment section with selector:', selector);
            insertionPoint = paymentSection;
            break;
          }
        }
        
        if (!paymentSection) {
          console.log('CryptoCadet: No payment section found. Available elements:', 
            document.querySelectorAll('*[class*="payment"], *[id*="payment"], *[data*="payment"]'));
          return;
        }
      } else {
        // Find Add to Cart button (product pages)
        const addToCartBtn = document.querySelector(
          'form[action*="/cart/add"] input[type="submit"], button[name="add"]'
        );
    
        // Or find cart checkout button (cart page)
        const checkoutBtn = document.querySelector('form[action*="/checkout"] [type="submit"], .cart__checkout');
    
        targetBtn = addToCartBtn || checkoutBtn;
        if (!targetBtn) return;
        
        insertionPoint = targetBtn.parentNode;
      }
  
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
        width: 100%;
        box-sizing: border-box;
      `;
  
      // Redirect to your demo flow
      cryptoBtn.addEventListener("click", function () {
        const productTitle = document.querySelector("h1")?.innerText || "Cart";
        const priceText =
          document.querySelector(".price, .product-price, .cart__subtotal, .payment-due-label")?.innerText ||
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
  
      // Insert the button
      if (insertionPoint) {
        insertionPoint.appendChild(cryptoBtn);
        console.log('CryptoCadet: Button added successfully');
      }
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