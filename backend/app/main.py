from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import calculations as calc
from . import schemas
from .database import Base, engine, get_db
from .models import CalculationRun, Debtor, Payment

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Loan Servicing API", version="1.0.0")


def get_debtor_or_404(debtor_id: int, db: Session) -> Debtor:
    debtor = db.get(Debtor, debtor_id)
    if debtor is None:
        raise HTTPException(status_code=404, detail="Debtor not found")
    return debtor


# ── Debtors ──────────────────────────────────────────────────────────

@app.post("/debtors", response_model=schemas.DebtorOut, status_code=201)
def create_debtor(payload: schemas.DebtorCreate, db: Session = Depends(get_db)):
    existing = db.scalar(select(Debtor).where(Debtor.loan_number == payload.loan_number))
    if existing:
        raise HTTPException(status_code=409, detail="loan_number already exists")
    debtor = Debtor(**payload.model_dump())
    db.add(debtor)
    db.commit()
    db.refresh(debtor)
    return debtor


@app.get("/debtors", response_model=list[schemas.DebtorOut])
def list_debtors(offset: int = 0, limit: int = 50, db: Session = Depends(get_db)):
    return db.scalars(select(Debtor).offset(offset).limit(limit)).all()


@app.get("/debtors/{debtor_id}", response_model=schemas.DebtorOut)
def get_debtor(debtor_id: int, db: Session = Depends(get_db)):
    return get_debtor_or_404(debtor_id, db)


@app.patch("/debtors/{debtor_id}", response_model=schemas.DebtorOut)
def update_debtor(debtor_id: int, payload: schemas.DebtorUpdate, db: Session = Depends(get_db)):
    debtor = get_debtor_or_404(debtor_id, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(debtor, field, value)
    db.commit()
    db.refresh(debtor)
    return debtor


@app.delete("/debtors/{debtor_id}", status_code=204)
def delete_debtor(debtor_id: int, db: Session = Depends(get_db)):
    debtor = get_debtor_or_404(debtor_id, db)
    db.delete(debtor)
    db.commit()


# ── Payment history ──────────────────────────────────────────────────

@app.post("/debtors/{debtor_id}/payments", response_model=schemas.PaymentOut, status_code=201)
def add_payment(debtor_id: int, payload: schemas.PaymentCreate, db: Session = Depends(get_db)):
    get_debtor_or_404(debtor_id, db)
    payment = Payment(debtor_id=debtor_id, **payload.model_dump())
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


@app.get("/debtors/{debtor_id}/payments", response_model=list[schemas.PaymentOut])
def list_payments(debtor_id: int, db: Session = Depends(get_db)):
    get_debtor_or_404(debtor_id, db)
    stmt = select(Payment).where(Payment.debtor_id == debtor_id).order_by(Payment.due_date)
    return db.scalars(stmt).all()


# ── Calculation unit ─────────────────────────────────────────────────

def _run_loan_calc(debtor: Debtor) -> calc.LoanCalculation:
    return calc.calc_loan(
        principal=debtor.principal,
        rate_pct=debtor.rate_pct,
        term_months=debtor.term_months,
        current_balance=debtor.current_balance,
        escrow_tax_monthly=debtor.escrow_tax_monthly,
        escrow_ins_monthly=debtor.escrow_ins_monthly,
        escrow_pmi_monthly=debtor.escrow_pmi_monthly,
        escrow_other_monthly=debtor.escrow_other_monthly,
        advances=debtor.advances,
        nsf_fees=debtor.nsf_fees,
        legal_fees=debtor.legal_fees,
        other_fees=debtor.other_fees,
        suspense_balance=debtor.suspense_balance,
        days_past_due=debtor.days_past_due,
        missed_payments=debtor.missed_payments,
        day_count_convention=debtor.day_count_convention,
        property_value=debtor.property_value,
    )


@app.post("/debtors/{debtor_id}/calculate", response_model=schemas.LoanCalculationOut)
def calculate_loan(debtor_id: int, db: Session = Depends(get_db)):
    """Run the calculation unit against the debtor's current stored
    figures and log an audit snapshot of the result."""
    debtor = get_debtor_or_404(debtor_id, db)
    result = _run_loan_calc(debtor)

    db.add(CalculationRun(
        debtor_id=debtor.id,
        base_payment=result.base_payment,
        escrow_monthly=result.escrow_monthly,
        total_piti=result.total_piti,
        per_diem=result.per_diem,
        status=result.status,
    ))
    db.commit()
    return result


@app.get("/debtors/{debtor_id}/amortization", response_model=list[schemas.AmortizationRowOut])
def amortization_schedule(debtor_id: int, db: Session = Depends(get_db)):
    debtor = get_debtor_or_404(debtor_id, db)
    result = _run_loan_calc(debtor)
    schedule = calc.build_amortization_schedule(
        principal=debtor.principal,
        rate_pct=debtor.rate_pct,
        term_months=debtor.term_months,
        escrow_monthly=result.escrow_monthly,
        origination_date=debtor.origination_date,
    )
    return schedule


@app.post("/debtors/{debtor_id}/reinstatement", response_model=schemas.ReinstatementOut)
def reinstatement_quote(
    debtor_id: int,
    payload: schemas.ReinstatementInput,
    db: Session = Depends(get_db),
):
    debtor = get_debtor_or_404(debtor_id, db)
    loan = _run_loan_calc(debtor)
    result = calc.calc_reinstatement(
        loan=loan,
        missed_payments=debtor.missed_payments,
        days_past_due=debtor.days_past_due,
        per_diem_days=payload.per_diem_days,
        fc_costs=payload.fc_costs,
        title_fees=payload.title_fees,
        property_preservation=payload.property_preservation,
        bankruptcy_costs=payload.bankruptcy_costs,
        escrow_shortage=payload.escrow_shortage,
        suspense_credit=payload.suspense_credit,
        partial_payment_credit=payload.partial_payment_credit,
        advances=debtor.advances,
        nsf_fees=debtor.nsf_fees,
        last_paid_installment=payload.last_paid_installment,
        due_date=payload.due_date,
    )

    run = db.scalar(
        select(CalculationRun)
        .where(CalculationRun.debtor_id == debtor_id)
        .order_by(CalculationRun.computed_at.desc())
    )
    if run:
        run.reinstatement_net = result.net_reinstatement
        db.commit()

    return result


@app.get("/debtors/{debtor_id}/calculation-runs", response_model=list[schemas.CalculationRunOut])
def calculation_history(debtor_id: int, db: Session = Depends(get_db)):
    get_debtor_or_404(debtor_id, db)
    stmt = (
        select(CalculationRun)
        .where(CalculationRun.debtor_id == debtor_id)
        .order_by(CalculationRun.computed_at.desc())
    )
    return db.scalars(stmt).all()
