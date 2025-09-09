// Shopify Checkout UI Extension
import {
    extend,
    Banner,
    BlockStack,
    Button,
    Checkbox,
    Text,
    useApi,
    useTranslate,
    reactExtension,
  } from '@shopify/ui-extensions-react/checkout';
  
  export default reactExtension(
    'purchase.checkout.payment-method-list.render-after',
    () => <Extension />
  );
  
  function Extension() {
    const { applyAttributeChange, query } = useApi();
    const translate = useTranslate();
  
    const handleCryptoPayment = async () => {
      // Set checkout attribute to indicate crypto payment selected
      await applyAttributeChange({
        type: 'updateAttribute',
        key: 'payment_method',
        value: 'cryptocadet_crypto'
      });
  
      // Redirect to crypto payment interface
      const checkoutUrl = query.data?.checkout?.webUrl;
      const redirectUrl = `https://shopify.cryptocadet.app/payments/sessions?checkout=${encodeURIComponent(checkoutUrl)}`;
      
      window.open(redirectUrl, '_blank');
    };
  
    return (
      <BlockStack border="base" cornerRadius="base" padding="base">
        <Text emphasis="bold">Pay with Cryptocurrency</Text>
        <Text>Bitcoin, Ethereum, USDC accepted</Text>
        <Button onPress={handleCryptoPayment}>
          Pay with Crypto
        </Button>
      </BlockStack>
    );
  }