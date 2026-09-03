
const stripe = require('stripe')(
  '{{TEST_SECRET_KEY}}',
  {
    // @ts-ignore overrides the pinned API version
    apiVersion: '2026-08-26.dahlia; custom_checkout_payment_form_preview=v1',
  }
);

const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  ui_mode: 'form',
  line_items: [
    {
      price_data: {
        currency: '',
        product_data: {
          name: '{{PRODUCT_NAME}}',
        },
        unit_amount: 2000,
      },
      quantity: 1,
    },
  ],
  billing_address_collection: 'auto',
  submit_type: 'auto',
  integration_identifier: 'custom_embedded_web_0001',
  origin_context: 'web',
});

res.redirect(303, session.url);
