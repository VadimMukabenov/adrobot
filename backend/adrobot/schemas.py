from typing import Literal

import pycountry
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator


class Revision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: StrictInt = Field(ge=0)


class Edit(Revision):
    action: Literal["add", "remove", "restore", "pin", "unpin"]
    offer_id: StrictInt = Field(gt=0)
    share: StrictInt | None = Field(default=None, ge=0, le=100)


class CreateCampaign(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=200)
    country: str = Field(pattern=r"^[A-Z]{2}$")
    offer_id: StrictInt = Field(gt=0)
    domain_id: StrictInt = Field(gt=0)
    group_id: StrictInt = Field(gt=0)
    traffic_source_id: StrictInt = Field(gt=0)
    operation_id: str = Field(pattern=r"^[a-zA-Z0-9-]{16,64}$")

    @field_validator("country")
    @classmethod
    def valid_country(cls, value):
        if pycountry.countries.get(alpha_2=value) is None:
            raise ValueError("Use an existing ISO 3166-1 alpha-2 country code.")
        return value
