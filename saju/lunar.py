"""한국 음력 → 양력 변환 (1900~2050년, 한국천문연구원 기준).

음력 데이터표는 korean-lunar-calendar 0.3.1 (MIT License, Copyright (c) 2018-2020 Jinil Lee)에서
1900~2050년 부분만 가져왔다. 각 값의 비트 구성:
  0~11비트: 1~12월이 큰달(30일)인지 (월 m 은 12-m 번째 비트)
  12~15비트: 윤달이 있는 달(0이면 없음), 16비트: 윤달이 큰달인지, 17~25비트: 그해 음력 총 일수
"""
from datetime import date, timedelta

BASE_YEAR = 1900
BASE_SOLAR = date(1900, 1, 31)  # 음력 1900-01-01
MIN_YEAR, MAX_YEAR = 1900, 2050

LUNAR_DATA = [
    0x830084bd, 0x82c404ae, 0x82c60a57, 0x82fe554d, 0xc2c40d26, 0x82c60d95, 0x83014655, 0x82c4056a, 0xc2c609ad, 0x8300255d,  # 1900
    0x82c404ae, 0x83006a5b, 0xc2c40a4d, 0x82c40d25, 0x83005da9, 0x82c60b55, 0xc2c4056a, 0x83002ada, 0x82c6095d, 0x830074bb,  # 1910
    0xc2c4049b, 0x82c40a4b, 0x83005b4b, 0x82c406a9, 0xc2c40ad4, 0x83024bb5, 0x82c402b6, 0x82c6095b, 0xc3002537, 0x82c40497,  # 1920
    0x82fe6656, 0x82c40e4a, 0xc2c60ea5, 0x830156a9, 0x82c605b5, 0x82c402b6, 0xc30138ae, 0x82c4092e, 0x83017c8d, 0x82c40c95,  # 1930
    0xc2c40d4a, 0x83016d8a, 0x82c60b69, 0x82c6056d, 0xc301425b, 0x82c4025d, 0x82c4092d, 0x83002d2b, 0xc2c40a95, 0x83007d55,  # 1940
    0x82c40b4a, 0x82c60b55, 0xc3015555, 0x82c604db, 0x82c4025b, 0x83013857, 0xc2c4052b, 0x83008a9b, 0x82c40695, 0x82c406aa,  # 1950
    0xc3006aea, 0x82c60ab5, 0x82c404b6, 0x83004aae, 0xc2c60a57, 0x82c40527, 0x82fe3726, 0x82c60d95, 0xc30076b5, 0x82c4056a,  # 1960
    0x82c609ad, 0x830054dd, 0xc2c404ae, 0x82c40a4e, 0x83004d4d, 0x82c40d25, 0xc3008d59, 0x82c40b54, 0x82c60d6a, 0x8301695a,  # 1970
    0xc2c6095b, 0x82c4049b, 0x83004a9b, 0x82c40a4b, 0xc300ab27, 0x82c406a5, 0x82c406d4, 0x83026b75, 0xc2c402b6, 0x82c6095b,  # 1980
    0x830054b7, 0x82c40497, 0xc2c4064b, 0x82fe374a, 0x82c60ea5, 0x830086d9, 0xc2c605ad, 0x82c402b6, 0x8300596e, 0x82c4092e,  # 1990
    0xc2c40c96, 0x83004e95, 0x82c40d4a, 0x82c60da5, 0xc3002755, 0x82c4056c, 0x83027abb, 0x82c4025d, 0xc2c4092d, 0x83005cab,  # 2000
    0x82c40a95, 0x82c40b4a, 0xc3013b4a, 0x82c60b55, 0x8300955d, 0x82c404ba, 0xc2c60a5b, 0x83005557, 0x82c4052b, 0x82c40a95,  # 2010
    0xc3004b95, 0x82c406aa, 0x82c60ad5, 0x830026b5, 0xc2c404b6, 0x83006a6e, 0x82c60a57, 0x82c40527, 0xc2fe56a6, 0x82c60d93,  # 2020
    0x82c405aa, 0x83003b6a, 0xc2c6096d, 0x8300b4af, 0x82c404ae, 0x82c40a4d, 0xc3016d0d, 0x82c40d25, 0x82c40d52, 0x83005dd4,  # 2030
    0xc2c60b6a, 0x82c6096d, 0x8300255b, 0x82c4049b, 0xc3007a57, 0x82c40a4b, 0x82c40b25, 0x83015b25, 0xc2c406d4, 0x82c60ada,  # 2040
    0x830138b6,  # 2050
]


def _info(year):
    if not MIN_YEAR <= year <= MAX_YEAR:
        raise ValueError(f"음력은 {MIN_YEAR}~{MAX_YEAR}년만 변환할 수 있습니다.")
    return LUNAR_DATA[year - BASE_YEAR]


def leap_month(year):
    """그해 윤달(없으면 0)."""
    return (_info(year) >> 12) & 0xF


def month_days(year, month, leap=False):
    v = _info(year)
    if leap:
        if leap_month(year) != month:
            raise ValueError(f"음력 {year}년에는 윤{month}월이 없습니다.")
        return 30 if (v >> 16) & 1 else 29
    return 30 if (v >> (12 - month)) & 1 else 29


def year_days(year):
    return (_info(year) >> 17) & 0x1FF


def lunar_to_solar(year, month, day, leap=False):
    """음력 날짜 → 양력 date. 없는 날짜면 ValueError(사용자에게 보여줄 한국어 메시지)."""
    if not 1 <= month <= 12:
        raise ValueError("음력 월은 1~12 사이여야 합니다.")
    md = month_days(year, month, leap)
    if not 1 <= day <= md:
        raise ValueError(f"음력 {year}년 {'윤' if leap else ''}{month}월은 {md}일까지입니다.")
    days = sum(year_days(y) for y in range(BASE_YEAR, year))
    lm = leap_month(year)
    for m in range(1, month):
        days += month_days(year, m)
        if m == lm:
            days += month_days(year, m, True)
    if leap:
        days += month_days(year, month)  # 윤달은 같은 이름의 평달 다음에 온다
    return BASE_SOLAR + timedelta(days=days + day - 1)
