"""Pure loan-math calculation unit.

Ported from the mortgage calculator artifact's client-side JS
(calcBase, buildSchedule, calcReinstatement, updateServicing) so the
same figures can be computed server-side against data stored in the
debtor database. No I/O or DB access happens in this module -- it only
takes plain numbers/dates in and returns plain dicts/dataclasses out,
so it's easy to unit test in isolation.
"""

from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

MONTHS_PER_YEAR = 12
GRACE_PERIOD_DAYS = 15
LATE_CHARGE_RATE = 0.05


def round2(value: float) -> float:
    return float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def round4(value: float) -> float:
    return float(Decimal(str(value)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))


def months_between(d1: date, d2: date) -> int:
    return max(0, (d2.year - d1.year) * 12 + (d2.month - d1.month))


def calc_base_payment(principal: float, rate_pct: float, term_months: int) -> float:
    """Standard fixed-rate monthly P&I payment: M = P[r(1+r)^n]/[(1+r)^n-1]."""
    r = rate_pct / 100
    if term_months <= 0:
        return 0.0
    if r == 0:
        return round2(principal / term_months)
    mr = r / MONTHS_PER_YEAR
    f = (1 + mr) ** term_months
    return round2(principal * (mr * f) / (f - 1))


@dataclass
class LoanCalculation:
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


def calc_loan(
    *,
    principal: float,
    rate_pct: float,
    term_months: int,
    current_balance: float,
    escrow_tax_monthly: float = 0,
    escrow_ins_monthly: float = 0,
    escrow_pmi_monthly: float = 0,
    escrow_other_monthly: float = 0,
    advances: float = 0,
    nsf_fees: float = 0,
    legal_fees: float = 0,
    other_fees: float = 0,
    suspense_balance: float = 0,
    days_past_due: int = 0,
    missed_payments: int = 0,
    apply_per_diem: bool = True,
    auto_late_charge: bool = True,
    manual_late_charge: float = 0,
    day_count_convention: int = 360,
    property_value: float | None = None,
) -> LoanCalculation:
    """Port of the artifact's calculate(): base payment, interest/principal
    split, per-diem accrual, late charge, and PITI."""
    r = rate_pct / 100
    base = calc_base_payment(principal, rate_pct, term_months)
    interest = round2(current_balance * r / MONTHS_PER_YEAR)
    principal_portion = round2(max(base - interest, 0))
    per_diem = round4(current_balance * r / day_count_convention)
    per_diem_accrual = round2(per_diem * days_past_due) if apply_per_diem else 0.0

    if auto_late_charge:
        late_charge = round2(base * LATE_CHARGE_RATE) if days_past_due > GRACE_PERIOD_DAYS else 0.0
    else:
        late_charge = manual_late_charge

    escrow_monthly = round2(
        escrow_tax_monthly + escrow_ins_monthly + escrow_pmi_monthly + escrow_other_monthly
    )
    total_fees = round2(nsf_fees + legal_fees + other_fees)
    total_pi = round2(base + per_diem_accrual + advances + late_charge + total_fees - suspense_balance)
    total_piti = round2(total_pi + escrow_monthly)

    ltv_pct = round2((current_balance / property_value) * 100) if property_value else None
    equity = round2(property_value - current_balance) if property_value else None

    if missed_payments > 3:
        status = "seriously_delinquent"
    elif missed_payments > 0:
        status = "delinquent"
    elif days_past_due > 0:
        status = "past_due"
    else:
        status = "current"

    return LoanCalculation(
        base_payment=base,
        interest=interest,
        principal_portion=principal_portion,
        per_diem=per_diem,
        per_diem_accrual=per_diem_accrual,
        late_charge=late_charge,
        total_fees=total_fees,
        total_pi=total_pi,
        escrow_monthly=escrow_monthly,
        total_piti=total_piti,
        ltv_pct=ltv_pct,
        equity=equity,
        status=status,
    )


@dataclass
class AmortizationRow:
    month: int
    payment_date: date | None
    payment: float
    principal: float
    interest: float
    escrow: float
    balance: float
    cumulative_interest: float
    cumulative_principal: float


def build_amortization_schedule(
    principal: float,
    rate_pct: float,
    term_months: int,
    escrow_monthly: float = 0,
    origination_date: date | None = None,
) -> list[AmortizationRow]:
    """Port of buildSchedule(): full amortization table for the loan's
    original terms (not the current delinquent balance)."""
    r = rate_pct / 100
    base = calc_base_payment(principal, rate_pct, term_months)
    balance = principal
    cumulative_interest = 0.0
    cumulative_principal = 0.0
    schedule: list[AmortizationRow] = []

    for month in range(1, term_months + 1):
        interest = round2(balance * r / MONTHS_PER_YEAR)
        principal_paid = round2(min(base - interest, balance))
        balance = round2(max(balance - principal_paid, 0))
        cumulative_interest = round2(cumulative_interest + interest)
        cumulative_principal = round2(cumulative_principal + principal_paid)

        payment_date = None
        if origination_date:
            y, m = origination_date.year, origination_date.month + month
            y += (m - 1) // 12
            m = (m - 1) % 12 + 1
            payment_date = date(y, m, 1)

        schedule.append(
            AmortizationRow(
                month=month,
                payment_date=payment_date,
                payment=round2(principal_paid + interest),
                principal=principal_paid,
                interest=interest,
                escrow=escrow_monthly,
                balance=balance,
                cumulative_interest=cumulative_interest,
                cumulative_principal=cumulative_principal,
            )
        )
        if balance <= 0:
            break

    return schedule


@dataclass
class ReinstatementLineItem:
    priority: int
    category: str
    description: str
    quantity: int | str
    unit_amount: float
    total: float


@dataclass
class ReinstatementResult:
    auto_missed_payments: int
    gross_reinstatement: float
    credits: float
    net_reinstatement: float
    line_items: list[ReinstatementLineItem] = field(default_factory=list)


def calc_reinstatement(
    *,
    loan: LoanCalculation,
    missed_payments: int,
    days_past_due: int,
    per_diem_days: int = 0,
    fc_costs: float = 0,
    title_fees: float = 0,
    property_preservation: float = 0,
    bankruptcy_costs: float = 0,
    escrow_shortage: float = 0,
    suspense_credit: float = 0,
    partial_payment_credit: float = 0,
    advances: float = 0,
    nsf_fees: float = 0,
    last_paid_installment: date | None = None,
    due_date: date | None = None,
) -> ReinstatementResult:
    """Port of calcReinstatement(): the full cure-amount waterfall."""
    auto_missed = missed_payments
    if last_paid_installment and due_date:
        auto_missed = max(0, round(months_between(last_paid_installment, due_date) / 30))

    missed_pi = round2(auto_missed * loan.base_payment)
    missed_escrow = round2(auto_missed * loan.escrow_monthly)
    late_per_payment = round2(loan.base_payment * LATE_CHARGE_RATE) if days_past_due > GRACE_PERIOD_DAYS else 0.0
    late_total = round2(auto_missed * late_per_payment)
    per_diem_accrual = round2(loan.per_diem * per_diem_days)

    gross = round2(
        fc_costs
        + title_fees
        + property_preservation
        + bankruptcy_costs
        + advances
        + nsf_fees
        + late_total
        + per_diem_accrual
        + missed_escrow
        + missed_pi
        + escrow_shortage
    )
    credits = round2(suspense_credit + partial_payment_credit)
    net = round2(max(0.0, gross - credits))

    rows = [
        ReinstatementLineItem(1, "Foreclosure Attorney / Legal",
                               "Court costs, attorney fees, process fees", "-",
                               round2(fc_costs + bankruptcy_costs), round2(fc_costs + bankruptcy_costs)),
        ReinstatementLineItem(2, "Title / Recording Fees",
                               "Title search, trustee fees, recording", "-", title_fees, title_fees),
        ReinstatementLineItem(3, "Property Preservation",
                               "Inspections, winterization, securing property", "-",
                               property_preservation, property_preservation),
        ReinstatementLineItem(4, "Corporate Advances",
                               "Servicer-paid taxes, insurance, and other advances", "-", advances, advances),
        ReinstatementLineItem(5, "NSF / Returned Item Fee",
                               "Returned payment processing charges", "-", nsf_fees, nsf_fees),
        ReinstatementLineItem(6, "Late Charges",
                               f"{auto_missed} payments x {LATE_CHARGE_RATE*100:.0f}% of P&I "
                               f"(after {GRACE_PERIOD_DAYS}-day grace)",
                               auto_missed, late_per_payment, late_total),
        ReinstatementLineItem(7, "Per Diem Interest Accrual",
                               f"{per_diem_days} days x daily rate", per_diem_days,
                               loan.per_diem, per_diem_accrual),
        ReinstatementLineItem(8, "Escrow Shortage",
                               "Annual escrow shortfall per RESPA analysis", "-",
                               escrow_shortage, escrow_shortage),
        ReinstatementLineItem(9, "Missed Escrow Payments",
                               f"{auto_missed} payments x monthly escrow (T&I)",
                               auto_missed, loan.escrow_monthly, missed_escrow),
        ReinstatementLineItem(10, "Missed P&I Payments",
                              f"{auto_missed} payments x base P&I payment",
                              auto_missed, loan.base_payment, missed_pi),
    ]
    rows = [row for row in rows if row.total > 0]

    return ReinstatementResult(
        auto_missed_payments=auto_missed,
        gross_reinstatement=gross,
        credits=credits,
        net_reinstatement=net,
        line_items=rows,
    )
