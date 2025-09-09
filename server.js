const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

console.log('API Key:', process.env.SHOPIFY_API_KEY ? 'Set' : 'Missing');
console.log('API Secret:', process.env.SHOPIFY_API_SECRET ? 'Set' : 'Missing');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for embedded apps
}));

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

// Add ngrok bypass header
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// Body parsing middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    app: 'cryptocadet-payment-gateway',
    shopify_api_key: process.env.SHOPIFY_API_KEY ? 'configured' : 'missing'
  });
});

// Root endpoint
app.get('/', (req, res) => {
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
});

// Shopify OAuth endpoints
app.get('/auth', (req, res) => {
  const { shop, hmac, code, state, timestamp } = req.query;
  
  // TODO: Implement proper OAuth flow
  res.json({
    message: 'OAuth endpoint - to be implemented',
    shop: shop,
    received_params: Object.keys(req.query)
  });
});

app.get('/auth/callback', (req, res) => {
  // TODO: Handle OAuth callback
  res.json({
    message: 'OAuth callback - to be implemented',
    query: req.query
  });
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