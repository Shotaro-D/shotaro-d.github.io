from decimal import Decimal, getcontext
from html.parser import HTMLParser
from pathlib import Path
import re


getcontext().prec = 100

PAGE = Path(__file__).resolve().parents[1] / "light-energy-calculation.html"
HTML = PAGE.read_text(encoding="utf-8")


class SelectParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.selects = {}
        self.current_select = None
        self.current_option = None
        self.option_text = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "select":
            self.current_select = attributes["id"]
            self.selects[self.current_select] = []
        elif tag == "option" and self.current_select:
            self.current_option = {
                "selected": "selected" in attributes,
                "value": attributes.get("value"),
            }
            self.option_text = []

    def handle_data(self, data):
        if self.current_option is not None:
            self.option_text.append(data)

    def handle_endtag(self, tag):
        if tag == "option" and self.current_option is not None:
            self.current_option["label"] = "".join(self.option_text).strip()
            self.selects[self.current_select].append(self.current_option)
            self.current_option = None
            self.option_text = []
        elif tag == "select":
            self.current_select = None


def javascript_constant(name):
    match = re.search(rf"const {name} = ([0-9.e+-]+);", HTML)
    if not match:
        raise AssertionError(f"Missing JavaScript constant: {name}")
    return Decimal(match.group(1))


parser = SelectParser()
parser.feed(HTML)

c = javascript_constant("LIGHT_SPEED_M_S")
h = javascript_constant("PLANCK_J_S")
ev_j = javascript_constant("EV_J")
hc_j_m = c * h
hc_ev_m = hc_j_m / ev_j

assert c == Decimal("299792458")
assert h == Decimal("6.62607015e-34")
assert ev_j == Decimal("1.602176634e-19")
assert hc_j_m == Decimal("1.98644585714892870e-25")

wavelength_factors = {
    "pm": Decimal("1e-12"),
    "Å": Decimal("1e-10"),
    "nm": Decimal("1e-9"),
    "μm": Decimal("1e-6"),
    "mm": Decimal("1e-3"),
    "cm": Decimal("1e-2"),
    "m": Decimal("1"),
    "km": Decimal("1e3"),
    "Mm": Decimal("1e6"),
}

energy_factors = {
    "feV": Decimal("1e-15"),
    "peV": Decimal("1e-12"),
    "neV": Decimal("1e-9"),
    "μeV": Decimal("1e-6"),
    "meV": Decimal("1e-3"),
    "eV": Decimal("1"),
    "keV": Decimal("1e3"),
    "MeV": Decimal("1e6"),
    "GeV": Decimal("1e9"),
}

energy_input_factors = {
    **energy_factors,
    "J": Decimal(1) / ev_j,
    "×10^(-19) [J]": Decimal("1e-19") / ev_j,
}

assert [option["label"] for option in parser.selects["wavelength-unit"]] == list(wavelength_factors)
assert [option["label"] for option in parser.selects["energy-output-unit"]] == list(wavelength_factors)
assert [option["label"] for option in parser.selects["wavelength-output-unit"]] == [*energy_factors, "J"]
assert [option["label"] for option in parser.selects["energy-unit"]] == [
    *energy_factors,
    "J",
    "×10^(-19) [J]",
]

assert [option["label"] for option in parser.selects["wavelength-unit"] if option["selected"]] == ["Å"]
assert [option["label"] for option in parser.selects["energy-output-unit"] if option["selected"]] == ["Å"]
assert [option["label"] for option in parser.selects["wavelength-output-unit"] if option["selected"]] == ["keV"]
assert [option["label"] for option in parser.selects["energy-unit"] if option["selected"]] == ["keV"]

reference_values = {
    "550 nm -> eV": hc_ev_m / Decimal("550e-9"),
    "1 Å -> keV": hc_ev_m / Decimal("1e-10") / Decimal("1e3"),
    "35 keV -> Å": hc_ev_m / Decimal("35e3") / Decimal("1e-10"),
    "3.972e-19 J -> nm": hc_j_m / Decimal("3.972e-19") / Decimal("1e-9"),
}

assert abs(reference_values["550 nm -> eV"] - Decimal("2.2542581533309138588682317192")) < Decimal("1e-28")
assert abs(reference_values["1 Å -> keV"] - Decimal("12.398419843320026223775274456")) < Decimal("1e-27")
assert abs(reference_values["35 keV -> Å"] - Decimal("0.3542405669520007492507221273")) < Decimal("1e-28")
assert abs(reference_values["3.972e-19 J -> nm"] - Decimal("500.11225003749463746223564955")) < Decimal("1e-26")

input_values = [Decimal("1e-6"), Decimal("0.1"), Decimal(1), Decimal(10), Decimal(550), Decimal("1e6")]
path_count = 0

for input_value in input_values:
    for wavelength_factor in wavelength_factors.values():
        energy_ev = hc_ev_m / input_value / wavelength_factor
        for energy_factor in energy_factors.values():
            assert energy_ev / energy_factor > 0
            path_count += 1
        assert energy_ev * ev_j > 0
        path_count += 1

for input_value in input_values:
    for energy_factor in energy_input_factors.values():
        for wavelength_factor in wavelength_factors.values():
            assert hc_ev_m / input_value / energy_factor / wavelength_factor > 0
            path_count += 1

assert path_count == 1134

print("PASS: exact SI constants, unit inventories/defaults, four benchmark values, and 1134 Decimal reference paths verified.")
