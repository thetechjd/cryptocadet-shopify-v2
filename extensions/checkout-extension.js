(function () {
    function addCryptoButton() {
      console.log('CryptoCadet: Running addCryptoButton()');
      
      // Avoid duplicates
      if (document.getElementById("crypto-pay-btn")) {
        console.log('CryptoCadet: Button already exists');
        return;
      }
  
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
        console.log('CryptoCadet: Looking for product/cart buttons');
        
        // More specific selectors based on your HTML structure
        const buttonSelectors = [
          // Product page - your actual structure
          'button[name="add"][type="submit"]',
          '.product-form__buttons button[type="submit"]',
          'form[action*="/cart/add"] button[type="submit"]',
          'form[action*="/cart/add"] input[type="submit"]',
          // Generic fallbacks
          'button[name="add"]',
          '.product-form__submit',
          '.btn-product-form',
          // Cart page
          'form[action*="/checkout"] [type="submit"]', 
          '.cart__checkout',
          '.cart-footer button'
        ];
        
        for (const selector of buttonSelectors) {
          targetBtn = document.querySelector(selector);
          if (targetBtn) {
            console.log('CryptoCadet: Found target button with selector:', selector);
            break;
          }
        }
        
        if (!targetBtn) {
          console.log('CryptoCadet: No target button found. Available buttons:', 
            document.querySelectorAll('button, input[type="submit"]'));
          return;
        }
        
        // Find the best insertion point
        const buttonContainer = targetBtn.closest('.product-form__buttons') || 
                               targetBtn.closest('.product-form') || 
                               targetBtn.parentNode;
        insertionPoint = buttonContainer;
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
        console.log('CryptoCadet: Crypto button clicked');
        
        const productTitle = document.querySelector("h1, .product__title, .product-title")?.innerText || "Product";
        const priceText =
          document.querySelector(".price, .product__price, .product-price, .cart__subtotal, .payment-due-label")?.innerText ||
          "$0.00";
  
        const checkoutData = {
          product: productTitle,
          price: priceText,
          url: window.location.href,
        };
  
        const redirectUrl =
          "https://shopify.cryptocadet.app/crypto-demo?" +
          new URLSearchParams({ checkout: JSON.stringify(checkoutData) });
  
        console.log('CryptoCadet: Redirecting to:', redirectUrl);
        window.location.href = redirectUrl;
      });
  
      // Insert the button
      if (insertionPoint) {
        insertionPoint.appendChild(cryptoBtn);
        console.log('CryptoCadet: Button added successfully to:', insertionPoint);
      } else {
        console.log('CryptoCadet: No insertion point found');
      }
    }
  
    // Run immediately when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', addCryptoButton);
    } else {
      addCryptoButton();
    }
  
    // Watch for theme DOM updates (Shopify themes often use AJAX)
    const observer = new MutationObserver(function(mutations) {
      let shouldRun = false;
      mutations.forEach(function(mutation) {
        if (mutation.addedNodes.length > 0) {
          shouldRun = true;
        }
      });
      if (shouldRun) {
        setTimeout(addCryptoButton, 100);
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  
    // Retry after delays to handle slow-loading themes
    setTimeout(addCryptoButton, 1000);
    setTimeout(addCryptoButton, 3000);
    setTimeout(addCryptoButton, 5000);
  })();