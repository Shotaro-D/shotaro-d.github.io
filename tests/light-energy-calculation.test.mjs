import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../light-energy-calculation.html', import.meta.url), 'utf8');
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
const calculatorScript = inlineScripts.at(-1);

assert.ok(calculatorScript.includes('photonEnergyFromWavelength'));
assert.ok(calculatorScript.includes('wavelengthFromPhotonEnergy'));

const instrumentedScript = calculatorScript.replace(
  /\n\s*\}\)\(\);\s*$/,
  '\n      globalThis.__calculatorTest = { photonEnergyFromWavelength, wavelengthFromPhotonEnergy };\n    })();'
);

assert.notEqual(instrumentedScript, calculatorScript, 'Failed to expose the calculator functions for testing.');

const elements = new Map();
const selectPattern = /<select id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g;
let selectMatch;

while ((selectMatch = selectPattern.exec(html))) {
  const options = [...selectMatch[2].matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/g)].map((match) => {
    const attributes = Object.fromEntries(
      [...match[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((attribute) => [attribute[1], attribute[2] ?? true])
    );
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    return {
      selected: Object.hasOwn(attributes, 'selected'),
      text,
      textContent: text,
      value: attributes.value
    };
  });
  const select = {
    options,
    selectedIndex: Math.max(0, options.findIndex((option) => option.selected))
  };
  Object.defineProperty(select, 'value', {
    get() {
      return this.options[this.selectedIndex].value;
    }
  });
  elements.set(selectMatch[1], select);
}

for (const [id, value] of [
  ['wavelength-value', '550'],
  ['wavelength-digits', '5'],
  ['energy-value', '35'],
  ['energy-digits', '5']
]) {
  elements.set(id, { value });
}

for (const id of ['wavelength-form', 'energy-form']) {
  elements.set(id, {
    addEventListener(type, callback) {
      this[type] = callback;
    }
  });
}

for (const id of [
  'wavelength-message',
  'energy-message',
  'wavelength-input-result',
  'wavelength-output-result',
  'energy-input-result',
  'energy-output-result'
]) {
  elements.set(id, { hidden: false, textContent: '' });
}

for (const id of ['wavelength-rounding-warning', 'energy-rounding-warning']) {
  elements.set(id, {
    hidden: true,
    textContent: '計算結果は正の値ですが，指定した小数点以下の桁数では0に丸められています。桁数を増やしてください。'
  });
}

const document = {
  getElementById(id) {
    assert.ok(elements.has(id), `Missing mock element: ${id}`);
    return elements.get(id);
  }
};

const context = { document, Error, Intl, Number };
vm.runInNewContext(instrumentedScript, context);

const C = 299792458;
const H = 6.62607015e-34;
const EV_J = 1.602176634e-19;
const HC_J_M = H * C;
const HC_EV_M = HC_J_M / EV_J;

const wavelengthFactors = {
  pm: 1e-12,
  Å: 1e-10,
  nm: 1e-9,
  μm: 1e-6,
  mm: 1e-3,
  cm: 1e-2,
  m: 1,
  km: 1e3,
  Mm: 1e6
};

const energyFactors = {
  feV: 1e-15,
  peV: 1e-12,
  neV: 1e-9,
  μeV: 1e-6,
  meV: 1e-3,
  eV: 1,
  keV: 1e3,
  MeV: 1e6,
  GeV: 1e9
};

const energyInputFactors = {
  ...energyFactors,
  J: 1 / EV_J,
  '×10^(-19) [J]': 1e-19 / EV_J
};

const selectOption = (id, label) => {
  const select = elements.get(id);
  select.selectedIndex = select.options.findIndex((option) => option.text === label);
  assert.notEqual(select.selectedIndex, -1, `Missing option ${label} in ${id}`);
};

const submit = (id) => elements.get(id).submit({ preventDefault() {} });
const displayedNumber = (id) => Number(elements.get(id).textContent.split(' ')[0]);
const relativeError = (actual, expected) => Math.abs(actual / expected - 1);
const inputValues = [1e-6, 0.1, 1, 10, 550, 1e6];

elements.get('wavelength-digits').value = '100';
elements.get('energy-digits').value = '100';

let standardPathCount = 0;
let maximumRelativeError = 0;

for (const inputValue of inputValues) {
  for (const [wavelengthLabel, wavelengthFactor] of Object.entries(wavelengthFactors)) {
    elements.get('wavelength-value').value = String(inputValue);
    selectOption('wavelength-unit', wavelengthLabel);

    for (const energyLabel of [...Object.keys(energyFactors), 'J']) {
      selectOption('wavelength-output-unit', energyLabel);
      submit('wavelength-form');

      const actual = displayedNumber('wavelength-output-result');
      const energyEV = HC_EV_M / (inputValue * wavelengthFactor);
      const expected = energyLabel === 'J' ? energyEV * EV_J : energyEV / energyFactors[energyLabel];
      const error = relativeError(actual, expected);

      assert.equal(elements.get('wavelength-message').textContent, '');
      assert.ok(Number.isFinite(actual));
      assert.ok(error < 1e-12, `${inputValue} ${wavelengthLabel} -> ${energyLabel}: ${actual} vs ${expected}`);
      maximumRelativeError = Math.max(maximumRelativeError, error);
      standardPathCount += 1;
    }
  }
}

for (const inputValue of inputValues) {
  for (const [energyLabel, energyFactor] of Object.entries(energyInputFactors)) {
    elements.get('energy-value').value = String(inputValue);
    selectOption('energy-unit', energyLabel);

    for (const [wavelengthLabel, wavelengthFactor] of Object.entries(wavelengthFactors)) {
      selectOption('energy-output-unit', wavelengthLabel);
      submit('energy-form');

      const actual = displayedNumber('energy-output-result');
      const expected = HC_EV_M / (inputValue * energyFactor) / wavelengthFactor;
      const error = relativeError(actual, expected);

      assert.equal(elements.get('energy-message').textContent, '');
      assert.ok(Number.isFinite(actual));
      assert.ok(error < 1e-12, `${inputValue} ${energyLabel} -> ${wavelengthLabel}: ${actual} vs ${expected}`);
      maximumRelativeError = Math.max(maximumRelativeError, error);
      standardPathCount += 1;
    }
  }
}

assert.equal(standardPathCount, 1134);

const edgeCases = [
  ['wavelength', 1e308, 'Mm', 'feV', HC_EV_M / 1e6 / 1e-15 / 1e308],
  ['wavelength', 1e-323, 'm', 'J', HC_J_M / 1e-323],
  ['wavelength', 1e-323, 'm', 'GeV', HC_EV_M / 1e9 / 1e-323],
  ['energy', 1e308, 'GeV', 'Å', HC_EV_M / 1e9 / 1e-10 / 1e308],
  ['energy', 1e290, 'J', 'Å', HC_J_M / 1e-10 / 1e290],
  ['energy', 1e-301, 'feV', 'km', HC_EV_M / 1e-15 / 1e3 / 1e-301],
  ['energy', 1e-305, '×10^(-19) [J]', 'm', HC_J_M / 1e-19 / 1e-305]
];

for (const [direction, inputValue, inputUnit, outputUnit, expected] of edgeCases) {
  let actual;
  if (direction === 'wavelength') {
    selectOption('wavelength-unit', inputUnit);
    selectOption('wavelength-output-unit', outputUnit);
    actual = context.__calculatorTest.photonEnergyFromWavelength(
      inputValue,
      elements.get('wavelength-unit'),
      elements.get('wavelength-output-unit')
    );
  } else {
    selectOption('energy-unit', inputUnit);
    selectOption('energy-output-unit', outputUnit);
    actual = context.__calculatorTest.wavelengthFromPhotonEnergy(
      inputValue,
      elements.get('energy-unit'),
      elements.get('energy-output-unit')
    );
  }
  assert.ok(Number.isFinite(actual));
  assert.ok(relativeError(actual, expected) < 5e-14, `${direction}: ${actual} vs ${expected}`);
}

elements.get('wavelength-value').value = '550';
elements.get('wavelength-digits').value = '5';
selectOption('wavelength-unit', 'Å');
selectOption('wavelength-output-unit', 'keV');
submit('wavelength-form');
assert.equal(elements.get('wavelength-output-result').textContent, '0.02254 keV');

elements.get('energy-value').value = '35';
elements.get('energy-digits').value = '5';
selectOption('energy-unit', 'keV');
selectOption('energy-output-unit', 'Å');
submit('energy-form');
assert.equal(elements.get('energy-output-result').textContent, '0.35424 Å');

elements.get('wavelength-value').value = '550';
elements.get('wavelength-digits').value = '5';
selectOption('wavelength-unit', 'nm');
selectOption('wavelength-output-unit', 'J');
submit('wavelength-form');
assert.equal(elements.get('wavelength-output-result').textContent, '0.00000 J');
assert.equal(elements.get('wavelength-rounding-warning').hidden, false);

elements.get('wavelength-digits').value = '20';
submit('wavelength-form');
assert.notEqual(elements.get('wavelength-output-result').textContent, '0.00000000000000000000 J');
assert.equal(elements.get('wavelength-rounding-warning').hidden, true);

elements.get('energy-value').value = '0';
submit('energy-form');
assert.notEqual(elements.get('energy-message').textContent, '');
assert.equal(elements.get('energy-input-result').textContent, '—');
assert.equal(elements.get('energy-output-result').textContent, '—');
assert.equal(elements.get('energy-rounding-warning').hidden, true);

elements.get('energy-value').value = '35';
elements.get('energy-digits').value = '1e2';
submit('energy-form');
assert.notEqual(elements.get('energy-message').textContent, '');
assert.equal(elements.get('energy-output-result').textContent, '—');

elements.get('wavelength-value').value = '1';
elements.get('wavelength-digits').value = '5';
selectOption('wavelength-unit', 'pm');
selectOption('wavelength-output-unit', 'feV');
submit('wavelength-form');
const largeFixedDecimal = elements.get('wavelength-output-result').textContent.split(' ')[0];
assert.doesNotMatch(largeFixedDecimal, /[eE][+-]?\d+/);

console.log(
  `PASS: ${standardPathCount} standard paths, ${edgeCases.length} extreme paths, ` +
  `maximum relative error ${maximumRelativeError}; defaults, rounding warning, validation, and decimal-only output verified.`
);
