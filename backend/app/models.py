from datetime import datetime, date

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Debtor(Base):
    """A borrower / loan record. Mirrors the fields captured on the
    loan servicing artifact's face page and payment tab."""

    __tablename__ = "debtors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Identification
    loan_number: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    borrower_name: Mapped[str] = mapped_column(String(120))
    # NOTE: SSNs are sensitive PII. This column stores it in plain text for
    # demo purposes only -- a production system must encrypt this at rest
    # (e.g. application-level encryption or a KMS-backed column) and
    # restrict read access.
    ssn: Mapped[str | None] = mapped_column(String(11), nullable=True)
    address: Mapped[str | None] = mapped_column(String(200), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # Loan identification
    lender: Mapped[str | None] = mapped_column(String(120), nullable=True)
    investor: Mapped[str | None] = mapped_column(String(120), nullable=True)
    lien_position: Mapped[str | None] = mapped_column(String(20), nullable=True)
    loan_type: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Origination terms
    origination_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    principal: Mapped[float] = mapped_column(Float, default=0)
    rate_pct: Mapped[float] = mapped_column(Float, default=0)
    term_months: Mapped[int] = mapped_column(Integer, default=360)
    day_count_convention: Mapped[int] = mapped_column(Integer, default=360)

    # Current position
    current_balance: Mapped[float] = mapped_column(Float, default=0)
    property_value: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Escrow (monthly)
    escrow_tax_monthly: Mapped[float] = mapped_column(Float, default=0)
    escrow_ins_monthly: Mapped[float] = mapped_column(Float, default=0)
    escrow_pmi_monthly: Mapped[float] = mapped_column(Float, default=0)
    escrow_other_monthly: Mapped[float] = mapped_column(Float, default=0)

    # Fees / advances / suspense carried on the account
    advances: Mapped[float] = mapped_column(Float, default=0)
    nsf_fees: Mapped[float] = mapped_column(Float, default=0)
    legal_fees: Mapped[float] = mapped_column(Float, default=0)
    other_fees: Mapped[float] = mapped_column(Float, default=0)
    suspense_balance: Mapped[float] = mapped_column(Float, default=0)

    # Delinquency inputs
    missed_payments: Mapped[int] = mapped_column(Integer, default=0)
    days_past_due: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    payments: Mapped[list["Payment"]] = relationship(
        back_populates="debtor", cascade="all, delete-orphan"
    )
    calculation_runs: Mapped[list["CalculationRun"]] = relationship(
        back_populates="debtor", cascade="all, delete-orphan"
    )


class Payment(Base):
    """A single entry in a debtor's payment history."""

    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    debtor_id: Mapped[int] = mapped_column(ForeignKey("debtors.id"), index=True)

    due_date: Mapped[date] = mapped_column(Date)
    received_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount_due: Mapped[float] = mapped_column(Float, default=0)
    amount_received: Mapped[float] = mapped_column(Float, default=0)
    late_charge: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(10), default="on_time")  # on_time|late|missed

    debtor: Mapped["Debtor"] = relationship(back_populates="payments")


class CalculationRun(Base):
    """Audit snapshot of a calculation unit run against a debtor's record."""

    __tablename__ = "calculation_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    debtor_id: Mapped[int] = mapped_column(ForeignKey("debtors.id"), index=True)
    computed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    base_payment: Mapped[float] = mapped_column(Float)
    escrow_monthly: Mapped[float] = mapped_column(Float)
    total_piti: Mapped[float] = mapped_column(Float)
    per_diem: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(24))
    reinstatement_net: Mapped[float | None] = mapped_column(Float, nullable=True)

    debtor: Mapped["Debtor"] = relationship(back_populates="calculation_runs")
