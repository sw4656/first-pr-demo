from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class DebtorBase(BaseModel):
    loan_number: str
    borrower_name: str
    ssn: str | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None

    lender: str | None = None
    investor: str | None = None
    lien_position: str | None = None
    loan_type: str | None = None

    origination_date: date | None = None
    principal: float = 0
    rate_pct: float = 0
    term_months: int = 360
    day_count_convention: int = 360

    current_balance: float = 0
    property_value: float | None = None

    escrow_tax_monthly: float = 0
    escrow_ins_monthly: float = 0
    escrow_pmi_monthly: float = 0
    escrow_other_monthly: float = 0

    advances: float = 0
    nsf_fees: float = 0
    legal_fees: float = 0
    other_fees: float = 0
    suspense_balance: float = 0

    missed_payments: int = 0
    days_past_due: int = 0


class DebtorCreate(DebtorBase):
    pass


class DebtorUpdate(BaseModel):
    """All fields optional -- PATCH-style partial update."""
    model_config = ConfigDict(extra="forbid")

    borrower_name: str | None = None
    ssn: str | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    lender: str | None = None
    investor: str | None = None
    lien_position: str | None = None
    loan_type: str | None = None
    origination_date: date | None = None
    principal: float | None = None
    rate_pct: float | None = None
    term_months: int | None = None
    day_count_convention: int | None = None
    current_balance: float | None = None
    property_value: float | None = None
    escrow_tax_monthly: float | None = None
    escrow_ins_monthly: float | None = None
    escrow_pmi_monthly: float | None = None
    escrow_other_monthly: float | None = None
    advances: float | None = None
    nsf_fees: float | None = None
    legal_fees: float | None = None
    other_fees: float | None = None
    suspense_balance: float | None = None
    missed_payments: int | None = None
    days_past_due: int | None = None


class DebtorOut(DebtorBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class PaymentCreate(BaseModel):
    due_date: date
    received_date: date | None = None
    amount_due: float = 0
    amount_received: float = 0
    late_charge: float = 0
    status: str = "on_time"  # on_time|late|missed


class PaymentOut(PaymentCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    debtor_id: int


class ReinstatementInput(BaseModel):
    """Extra one-off costs/credits that aren't part of the stored debtor
    record but are needed to price a specific reinstatement quote."""
    per_diem_days: int = 0
    fc_costs: float = 0
    title_fees: float = 0
    property_preservation: float = 0
    bankruptcy_costs: float = 0
    escrow_shortage: float = 0
    suspense_credit: float = 0
    partial_payment_credit: float = 0
    last_paid_installment: date | None = None
    due_date: date | None = None


class LoanCalculationOut(BaseModel):
    base_payment: float
    interest: float
    principal_portion: float
    per_diem: float
    per_diem_accrual: float
    late_charge: float
    total_fees: float
    total_pi: float
    escrow_monthly: float
    total_piti: float
    ltv_pct: float | None
    equity: float | None
    status: str


class ReinstatementLineItemOut(BaseModel):
    priority: int
    category: str
    description: str
    quantity: int | str
    unit_amount: float
    total: float


class ReinstatementOut(BaseModel):
    auto_missed_payments: int
    gross_reinstatement: float
    credits: float
    net_reinstatement: float
    line_items: list[ReinstatementLineItemOut]


class AmortizationRowOut(BaseModel):
    month: int
    payment_date: date | None
    payment: float
    principal: float
    interest: float
    escrow: float
    balance: float
    cumulative_interest: float
    cumulative_principal: float


class CalculationRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    debtor_id: int
    computed_at: datetime
    base_payment: float
    escrow_monthly: float
    total_piti: float
    per_diem: float
    status: str
    reinstatement_net: float | None
