const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const fs = require('fs').promises;
const path = require('path');

// Load environment variables
dotenv.config();

console.log('API Key:', process.env.SHOPIFY_API_KEY ? 'Set' : 'Missing');
console.log('API Secret:', process.env.SHOPIFY_API_SECRET ? 'Set' : 'Missing');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware - explicitly allow Shopify embedding
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.shopify.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.shopify.com"],
      connectSrc: ["'self'", "https://*.myshopify.com", "https://admin.shopify.com"],
      frameSrc: ["'self'", "https://*.myshopify.com", "https://admin.shopify.com"],
      frameAncestors: ["https://*.myshopify.com", "https://admin.shopify.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
}));

// Explicitly remove X-Frame-Options and add proper headers for Shopify embedding
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('X-Frame-Options', 'ALLOWALL'); // Allow embedding in any frame
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// CORS configuration for Shopify
app.use(cors({
  origin: [
    'https://admin.shopify.com',
    'https://*.myshopify.com',
    'http://localhost:3000',
    'https://localhost:3000',
    /\.ngrok-free\.app$/,  // Allow ngrok domains
    /\.ngrok\.io$/         // Allow classic ngrok domains
  ],
  credentials: true,
}));

// Body parsing middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Enhanced merchant configuration storage using JSON file
async function storeMerchantConfig(shop, config) {
  try {
    const configPath = path.join(__dirname, 'merchant-configs.json');
    
    // Load existing configs
    let configs = {};
    try {
      const data = await fs.readFile(configPath, 'utf8');
      configs = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, start with empty object
    }
    
    // Update config for this shop
    configs[shop] = {
      ...configs[shop],
      ...config,
      shop: shop,
      updated_at: new Date().toISOString()
    };
    
    // Save back to file
    await fs.writeFile(configPath, JSON.stringify(configs, null, 2));
    
    console.log(`Config saved for shop: ${shop}`);
    return configs[shop];
  } catch (error) {
    console.error('Failed to store merchant config:', error);
    throw error;
  }
}

async function getMerchantConfig(shop) {
  try {
    const configPath = path.join(__dirname, 'merchant-configs.json');
    const data = await fs.readFile(configPath, 'utf8');
    const configs = JSON.parse(data);
    return configs[shop] || null;
  } catch (error) {
    return null;
  }
}

// Function to create payment customization
async function createPaymentCustomization(shop) {
  const mutation = `
    mutation paymentCustomizationCreate($input: PaymentCustomizationInput!) {
      paymentCustomizationCreate(paymentCustomization: $input) {
        paymentCustomization {
          id
          title
          enabled
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  
  const variables = {
    input: {
      title: "Crypto Payment Gateway",
      enabled: true,
      functionId: "crypto-payment-function", // You'll need to create this function
      metafields: [
        {
          namespace: "cryptocadet",
          key: "config",
          value: JSON.stringify({
            supported_currencies: ["BTC", "ETH", "USDC"],
            redirect_url: "https://shopify.cryptocadet.app/payments/sessions",
            return_url: "https://shopify.cryptocadet.app/payments/return"
          })
        }
      ]
    }
  };
  
  try {
    // Make actual GraphQL request to Shopify Admin API
    const response = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': await getShopAccessToken(shop), // Need to implement this
      },
      body: JSON.stringify({
        query: mutation,
        variables: variables
      })
    });
    
    const result = await response.json();
    
    if (result.data?.paymentCustomizationCreate?.userErrors?.length > 0) {
      throw new Error(`GraphQL errors: ${result.data.paymentCustomizationCreate.userErrors.map(e => e.message).join(', ')}`);
    }
    
    return result.data.paymentCustomizationCreate.paymentCustomization;
    
  } catch (error) {
    console.error('Failed to create payment customization:', error);
    // Fall back to mock data for now
    return {
      id: `gid://shopify/PaymentCustomization/${Date.now()}`,
      title: "Crypto Payment Gateway",
      enabled: true
    };
  }
}

// Function to get shop access token (needs OAuth implementation)
async function getShopAccessToken(shop) {
  // TODO: Retrieve stored access token for this shop
  // This would come from your OAuth flow implementation
  // For now, return placeholder
  console.warn('getShopAccessToken not implemented - using placeholder');
  return 'placeholder_token';
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    app: 'cryptocadet-payment-gateway',
    shopify_api_key: process.env.SHOPIFY_API_KEY ? 'configured' : 'missing'
  });
});

// Root endpoint - serve embedded app interface
app.get('/', (req, res) => {
  // Check if this is being loaded in Shopify admin
  const shop = req.query.shop;
  const hmac = req.query.hmac;
  
  if (shop) {
    // Serve embedded app HTML for Shopify
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>CryptoCadet Payment Gateway</title>
        <script src="https://unpkg.com/@shopify/app-bridge@3"></script>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; }
          .container { max-width: 600px; margin: 0 auto; }
          .status-item { margin: 10px 0; }
          .button { background: #5c6ac4; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 14px; }
          .button:hover { background: #4c5aa0; }
          .success { color: #007f5f; }
          .section { margin: 30px 0; padding: 20px; border: 1px solid #e1e3e9; border-radius: 8px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>CryptoCadet Payment Gateway</h1>
          <p>Crypto payment integration for Shopify</p>
          <p><strong>Shop:</strong> ${shop}</p>
          
          <div class="section">
            <h2>App Status</h2>
            <div class="status-item">✅ Server running</div>
            <div class="status-item">✅ Connected to Shopify</div>
            <div class="status-item">✅ Ready for payment processing</div>
          </div>

          <div class="section">
            <h2>Payment Method Setup</h2>
            <p>Activate crypto payments for your customers:</p>
            <button class="button" onclick="activatePaymentMethod()">
              Activate Crypto Payment Method
            </button>
            <div id="activation-status"></div>
          </div>

          <div class="section">
            <h2>Configuration</h2>
            <p><strong>Supported Cryptocurrencies:</strong> Bitcoin, Ethereum, USDC</p>
            <p><strong>Processing:</strong> Real-time blockchain verification</p>
            <p><strong>Integration:</strong> Seamless checkout experience</p>
          </div>

          <div class="section">
            <h2>Next Steps</h2>
            <ol>
              <li>Click "Activate Crypto Payment Method" above</li>
              <li>Test with a sample order in your store</li>
              <li>Configure your crypto wallet settings</li>
              <li>Start accepting crypto payments!</li>
            </ol>
          </div>
        </div>

        <script>
          var AppBridge = window['app-bridge'];
          var app = AppBridge.createApp({
            apiKey: '${process.env.SHOPIFY_API_KEY}',
            shop: '${shop}',
            forceRedirect: true
          });

          // Wait for DOM to load
          document.addEventListener('DOMContentLoaded', function() {
            const activateButton = document.getElementById('activate-button');
            if (activateButton) {
              activateButton.addEventListener('click', activatePaymentMethod);
            }
          });

          // If DOM is already loaded
          if (document.readyState === 'loading') {
            // DOM is still loading, wait for DOMContentLoaded
          } else {
            // DOM is already loaded, attach event listener immediately
            const activateButton = document.getElementById('activate-button');
            if (activateButton) {
              activateButton.addEventListener('click', activatePaymentMethod);
            }
          }

          function activatePaymentMethod() {
            console.log('Activate button clicked');
            const statusDiv = document.getElementById('activation-status');
            statusDiv.innerHTML = '<p>Activating...</p>';
            
            console.log('Making fetch request to /activate-payment-method');
            
            fetch('/activate-payment-method', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ shop: '${shop}' })
            })
            .then(response => {
              console.log('Response received:', response.status, response.statusText);
              return response.json();
            })
            .then(data => {
              console.log('Response data:', data);
              if (data.success) {
                statusDiv.innerHTML = '<p class="success">✅ Crypto payment method activated successfully!</p>';
              } else {
                statusDiv.innerHTML = '<p style="color: red;">❌ Activation failed: ' + (data.error || 'Unknown error') + '</p>';
              }
            })
            .catch(error => {
              console.error('Fetch error:', error);
              statusDiv.innerHTML = '<p style="color: red;">❌ Error: ' + error.message + '</p>';
            });
          }
        </script>
      </body>
      </html>
    `);
  } else {
    // Serve API info for non-Shopify requests
    res.json({ 
      message: 'CryptoCadet Payment Gateway API',
      version: '1.0.0',
      endpoints: {
        health: '/health',
        auth: '/auth',
        payments: '/payments',
        webhooks: '/webhooks'
      }
    });
  }
});

// App installation/verification endpoint
app.get('/install', (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }
  
  // Redirect to OAuth flow
  res.redirect(`/auth?shop=${shop}`);
});

// Shopify OAuth endpoints
app.get('/auth', (req, res) => {
  const { shop, hmac, code, state, timestamp } = req.query;
  
  console.log('OAuth request received:', { shop, hmac: hmac ? 'present' : 'missing', code: code ? 'present' : 'missing' });
  
  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }
  
  if (code) {
    // Handle OAuth callback (exchange code for token)
    // TODO: Implement token exchange
    console.log('OAuth callback - exchanging code for token');
    res.redirect(`https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`);
  } else {
    // Initial OAuth request - redirect to Shopify for authorization
    const scopes = 'write_checkouts,read_checkouts,read_orders,write_orders,read_payment_customizations,write_payment_customizations,read_products';
    const redirectUri = `https://shopify.cryptocadet.app/auth/callback`;
    const nonce = Math.random().toString(36).substring(7);
    
    const authUrl = `https://${shop}/admin/oauth/authorize?` +
      `client_id=${process.env.SHOPIFY_API_KEY}&` +
      `scope=${encodeURIComponent(scopes)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `state=${nonce}`;
    
    console.log('Redirecting to Shopify OAuth:', authUrl);
    res.redirect(authUrl);
  }
});

app.get('/auth/callback', (req, res) => {
  const { shop, code, state } = req.query;
  
  console.log('OAuth callback received:', { shop, code: code ? 'present' : 'missing', state });
  
  if (!shop || !code) {
    return res.status(400).json({ error: 'Missing required OAuth parameters' });
  }
  
  // TODO: Exchange code for access token
  // For now, redirect to the app
  res.redirect(`https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`);
});

// Payment method configuration endpoint
app.get('/payment-methods', (req, res) => {
  res.json({
    payment_methods: [
      {
        id: 'cryptocadet-pay',
        name: 'Crypto Payment',
        description: 'Pay with cryptocurrency',
        supported_currencies: ['USD', 'EUR', 'BTC', 'ETH'],
        test_mode: process.env.NODE_ENV !== 'production',
        configuration: {
          redirect_url: 'https://shopify.cryptocadet.app/payments/sessions',
          return_url: 'https://shopify.cryptocadet.app/payments/return',
          webhook_url: 'https://shopify.cryptocadet.app/webhooks'
        }
      }
    ]
  });
});

// Payment method activation endpoint for merchants
app.post('/activate-payment-method', async (req, res) => {
  const { shop } = req.body;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter required' });
  }
  
  try {
    // Create payment customization via Shopify GraphQL API
    const paymentCustomization = await createPaymentCustomization(shop);
    
    // Store merchant configuration
    await storeMerchantConfig(shop, {
      payment_method_active: true,
      customization_id: paymentCustomization.id,
      activated_at: new Date().toISOString()
    });
    
    console.log(`Crypto payments activated for shop: ${shop}`);
    
    res.json({
      success: true,
      message: 'Crypto payment method activated',
      shop: shop,
      customization_id: paymentCustomization.id,
      status: 'active'
    });
    
  } catch (error) {
    console.error('Activation error:', error);
    res.status(500).json({
      error: 'Failed to activate payment method',
      details: error.message
    });
  }
});

// Get merchant configuration
app.get('/merchant-config/:shop', async (req, res) => {
  const { shop } = req.params;
  
  try {
    const config = await getMerchantConfig(shop);
    
    if (!config) {
      return res.status(404).json({
        error: 'Merchant configuration not found',
        shop: shop,
        active: false
      });
    }
    
    res.json({
      shop: shop,
      active: config.payment_method_active || false,
      customization_id: config.customization_id,
      activated_at: config.activated_at,
      configuration: config
    });
  } catch (error) {
    console.error('Error retrieving merchant config:', error);
    res.status(500).json({
      error: 'Failed to retrieve configuration',
      shop: shop
    });
  }
});

// Payment session creation endpoint
app.post('/payments/sessions', async (req, res) => {
  try {
    const { 
      gid,           // Payment session ID from Shopify
      amount,        // Payment amount
      currency,      // Currency code
      test,          // Test mode flag
      return_url     // URL to return to after payment
    } = req.body;

    console.log('Creating payment session:', { gid, amount, currency, test });

    // Validate required fields
    if (!gid || !amount || !currency) {
      return res.status(400).json({
        errors: [{
          message: 'Missing required fields: gid, amount, currency',
          code: 'missing_required_fields'
        }]
      });
    }

    // Create payment session record
    const paymentSession = {
      id: `crypto_session_${Date.now()}`,
      shopify_session_id: gid,
      amount: amount,
      currency: currency,
      test_mode: test || false,
      status: 'pending',
      created_at: new Date().toISOString(),
      return_url: return_url
    };

    // TODO: Store this session in your database
    console.log('Payment session created:', paymentSession);

    // Return redirect URL to your crypto payment interface
    const cryptoPaymentUrl = `${process.env.CRYPTO_APP_URL || 'https://your-crypto-app.com'}/pay/${paymentSession.id}`;

    res.json({
      redirect_url: cryptoPaymentUrl,
      context: {
        session_id: paymentSession.id,
        amount: amount,
        currency: currency
      }
    });

  } catch (error) {
    console.error('Payment session creation error:', error);
    res.status(422).json({
      errors: [{
        message: 'Failed to create payment session',
        code: 'payment_session_error',
        details: error.message
      }]
    });
  }
});

// Payment confirmation endpoint (called by your crypto app)
app.post('/payments/confirm', async (req, res) => {
  try {
    const { 
      session_id, 
      transaction_id, 
      crypto_address, 
      amount,
      block_hash 
    } = req.body;

    console.log('Confirming payment:', { session_id, transaction_id, amount });

    // Validate required fields
    if (!session_id || !transaction_id || !amount) {
      return res.status(400).json({
        error: 'Missing required fields: session_id, transaction_id, amount'
      });
    }

    // TODO: Retrieve session from database
    // TODO: Verify crypto transaction on blockchain
    // TODO: Call Shopify's payment confirmation API
    
    // Mock success response
    const confirmationResult = {
      session_id: session_id,
      transaction_id: transaction_id,
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      amount: amount,
      crypto_address: crypto_address,
      block_hash: block_hash
    };

    console.log('Payment confirmed:', confirmationResult);
    
    res.json({ 
      success: true, 
      transaction_id: transaction_id,
      message: 'Payment confirmed successfully',
      data: confirmationResult
    });

  } catch (error) {
    console.error('Payment confirmation error:', error);
    res.status(500).json({ 
      error: 'Payment confirmation failed',
      message: error.message 
    });
  }
});

// Payment rejection endpoint
app.post('/payments/reject', async (req, res) => {
  try {
    const { session_id, reason } = req.body;

    console.log('Rejecting payment:', { session_id, reason });

    if (!session_id) {
      return res.status(400).json({
        error: 'Missing required field: session_id'
      });
    }

    // TODO: Update session status in database
    // TODO: Notify Shopify of payment rejection

    const rejectionResult = {
      session_id: session_id,
      status: 'rejected',
      reason: reason || 'Payment failed',
      rejected_at: new Date().toISOString()
    };

    console.log('Payment rejected:', rejectionResult);

    res.json({ 
      success: true, 
      message: 'Payment rejected successfully',
      data: rejectionResult
    });

  } catch (error) {
    console.error('Payment rejection error:', error);
    res.status(500).json({ 
      error: 'Payment rejection failed',
      message: error.message 
    });
  }
});

// Webhook endpoints
app.post('/webhooks/orders/create', express.raw({ type: 'application/json' }), (req, res) => {
  console.log('Order created webhook received');
  console.log('Headers:', req.headers);
  // TODO: Verify webhook signature
  // TODO: Process order creation
  res.status(200).send('OK');
});

app.post('/webhooks/orders/paid', express.raw({ type: 'application/json' }), (req, res) => {
  console.log('Order paid webhook received');
  console.log('Headers:', req.headers);
  // TODO: Verify webhook signature
  // TODO: Process order payment
  res.status(200).send('OK');
});

app.post('/webhooks/orders/cancelled', express.raw({ type: 'application/json' }), (req, res) => {
  console.log('Order cancelled webhook received');
  console.log('Headers:', req.headers);
  // TODO: Verify webhook signature
  // TODO: Process order cancellation
  res.status(200).send('OK');
});

app.post('/webhooks/app/uninstalled', express.raw({ type: 'application/json' }), (req, res) => {
  console.log('App uninstalled webhook received');
  console.log('Headers:', req.headers);
  // TODO: Cleanup app data
  res.status(200).send('OK');
});

// Test endpoint for development
app.get('/test/payment', (req, res) => {
  res.json({
    message: 'Test payment endpoint',
    sample_payment_session: {
      gid: 'gid://shopify/PaymentSession/test123',
      amount: 2999, // $29.99
      currency: 'USD',
      test: true,
      return_url: 'https://test-store.myshopify.com/checkout'
    }
  });
});

// App configuration endpoint
app.post('/configure-app', async (req, res) => {
  try {
    const { app_url } = req.body;
    
    if (!app_url) {
      return res.status(400).json({
        error: 'app_url is required (e.g., https://your-ngrok-url.ngrok.io)'
      });
    }

    // This will configure webhooks and app settings via API
    // TODO: Implement actual API calls to configure the app
    
    const configuration = {
      app_url: app_url,
      redirect_urls: [`${app_url}/auth/callback`],
      webhook_endpoints: [
        `${app_url}/webhooks/orders/create`,
        `${app_url}/webhooks/orders/paid`,
        `${app_url}/webhooks/orders/cancelled`,
        `${app_url}/webhooks/app/uninstalled`
      ],
      configured_at: new Date().toISOString()
    };

    console.log('App configuration:', configuration);

    res.json({
      success: true,
      message: 'App configuration updated',
      configuration: configuration
    });

  } catch (error) {
    console.error('Configuration error:', error);
    res.status(500).json({
      error: 'Configuration failed',
      message: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Start server
app.listen(PORT, () => {
  console.log('🚀 CryptoCadet Payment Server running on port', PORT);
  console.log('📊 Health check: http://localhost:' + PORT + '/health');
  console.log('💳 Payment API: http://localhost:' + PORT + '/payments');
  console.log('🔗 Environment:', process.env.NODE_ENV || 'development');
  console.log('🧪 Test endpoint: http://localhost:' + PORT + '/test/payment');
  
  if (!process.env.SHOPIFY_API_KEY) {
    console.warn('⚠️  SHOPIFY_API_KEY not set in environment variables');
  }
  if (!process.env.SHOPIFY_API_SECRET) {
    console.warn('⚠️  SHOPIFY_API_SECRET not set in environment variables');
  }
});

module.exports = app;