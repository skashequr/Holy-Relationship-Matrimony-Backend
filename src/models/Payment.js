const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    payerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    targetUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'BDT',
    },
    paymentMethod: {
      type: String,
      enum: ['bkash', 'nagad', 'rocket', 'card'],
      required: true,
    },
    paymentType: {
      type: String,
      enum: ['contact_unlock', 'subscription', 'premium'],
      default: 'contact_unlock',
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending',
    },
    transactionId: {
      type: String,
      unique: true,
      sparse: true,
    },
    gatewayTransactionId: {
      type: String,
    },
    gatewayResponse: {
      type: mongoose.Schema.Types.Mixed,
    },
    payerPhone: {
      type: String,
    },
    invoiceNumber: {
      type: String,
      unique: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
    refundedAt: Date,
    refundReason: String,
    // Set only when an admin has manually confirmed this transaction against
    // their real bKash/Nagad statement and deliberately reported it to
    // Google/Facebook as an ad conversion. Kept separate from `status` since
    // there is no payment gateway verifying transactions automatically —
    // approving a payment (to unlock contact) does not by itself mean the
    // transaction should be trusted as a genuine ad-attributed sale.
    adConversionTrackedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

// Auto-generate invoice number
paymentSchema.pre('save', async function (next) {
  if (!this.invoiceNumber) {
    const count = await mongoose.model('Payment').countDocuments();
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    this.invoiceNumber = `HRM${year}${month}${String(count + 1).padStart(6, '0')}`;
  }
  next();
});

paymentSchema.index({ payerId: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
