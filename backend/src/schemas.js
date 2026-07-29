const { z } = require("zod");

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const debtorBaseShape = {
  loanNumber: z.string().min(1),
  borrowerName: z.string().min(1),
  ssn: z.string().nullish(),
  address: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),

  lender: z.string().nullish(),
  investor: z.string().nullish(),
  lienPosition: z.string().nullish(),
  loanType: z.string().nullish(),

  originationDate: dateOnly.nullish(),
  principal: z.number().default(0),
  ratePct: z.number().default(0),
  termMonths: z.number().int().default(360),
  dayCountConvention: z.number().int().default(360),

  currentBalance: z.number().default(0),
  propertyValue: z.number().nullish(),

  escrowTaxMonthly: z.number().default(0),
  escrowInsMonthly: z.number().default(0),
  escrowPmiMonthly: z.number().default(0),
  escrowOtherMonthly: z.number().default(0),

  advances: z.number().default(0),
  nsfFees: z.number().default(0),
  legalFees: z.number().default(0),
  otherFees: z.number().default(0),
  suspenseBalance: z.number().default(0),

  missedPayments: z.number().int().default(0),
  daysPastDue: z.number().int().default(0),
};

const DebtorCreate = z.object(debtorBaseShape).strict();

const DebtorUpdate = z
  .object(debtorBaseShape)
  .partial()
  .omit({ loanNumber: true })
  .strict();

const PaymentCreate = z
  .object({
    dueDate: dateOnly,
    receivedDate: dateOnly.nullish(),
    amountDue: z.number().default(0),
    amountReceived: z.number().default(0),
    lateCharge: z.number().default(0),
    status: z.enum(["on_time", "late", "missed"]).default("on_time"),
  })
  .strict();

const ReinstatementInput = z
  .object({
    perDiemDays: z.number().int().default(0),
    fcCosts: z.number().default(0),
    titleFees: z.number().default(0),
    propertyPreservation: z.number().default(0),
    bankruptcyCosts: z.number().default(0),
    escrowShortage: z.number().default(0),
    suspenseCredit: z.number().default(0),
    partialPaymentCredit: z.number().default(0),
    lastPaidInstallment: dateOnly.nullish(),
    dueDate: dateOnly.nullish(),
  })
  .strict();

module.exports = {
  DebtorCreate,
  DebtorUpdate,
  PaymentCreate,
  ReinstatementInput,
};
