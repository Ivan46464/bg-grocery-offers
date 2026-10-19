"""
Database models (SQLModel = SQLAlchemy + Pydantic).

One table: `offers`. Every row is a single promotional offer from one store.
Scrapers wipe and re-insert a store's rows on each refresh, so the table
always reflects "what is on promotion right now".
"""
from datetime import date, datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Offer(SQLModel, table=True):
    __tablename__ = "offers"

    id: Optional[int] = Field(default=None, primary_key=True)

    store: str = Field(index=True)              # "Lidl" | "Kaufland" | "Billa" | "Metro"
    product_name: str = Field(index=True)       # e.g. "Краве сирене Родна стряха 400 г"

    original_price: Optional[float] = None      # price before the promotion (EUR), may be unknown
    discounted_price: float                     # current promo price (EUR)
    discount_percent: Optional[int] = None      # derived: round((1 - new/old) * 100)

    image_url: Optional[str] = None
    product_url: Optional[str] = None           # link back to the store page

    valid_from: Optional[date] = None
    valid_to: Optional[date] = None

    is_mock: bool = False                       # True when the row came from fallback demo data
    scraped_at: datetime = Field(default_factory=_utcnow)


class OfferRead(SQLModel):
    """Shape returned by the API (adds the fuzzy-match score for search results)."""

    id: int
    store: str
    product_name: str
    original_price: Optional[float]
    discounted_price: float
    discount_percent: Optional[int]
    image_url: Optional[str]
    product_url: Optional[str]
    valid_from: Optional[date]
    valid_to: Optional[date]
    is_mock: bool
    score: Optional[int] = None


class StoreStatus(SQLModel):
    store: str
    offers: int
    is_mock: bool
    last_scraped: Optional[datetime]
