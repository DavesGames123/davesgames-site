// ============================================================================
//  BREADBOARD LAB  ·  mcu/boards.js — the pin tables of the three boards
// ----------------------------------------------------------------------------
//  One record per board kind. The sketch runtime (mcu/runtime.js) and the
//  sketch compiler (mcu/compile.js) read these tables. SIM reads vdd to make
//  the pin drivers. Pin NAMES are the pin names of the part defs
//  (CONTRACT 3.5): 'D13', 'A0' on the 328 boards, '2', 'VP', 'TX0' on the
//  ESP32 devkit. Pin NUMBERS are what a sketch writes: 13, A0 = 14, GPIO 2.
//
//  A pin record: { gpio, pwm?, pwmFreq?, adc?, int?, inputOnly?, analogOnly? }
//    gpio ....... the number a sketch uses for this pin
//    pwm ........ analogWrite makes a real PWM wave (else it rounds to 0/1)
//    adc ........ the ADC channel; analogRead works on this pin
//    int ........ the external interrupt number (328: D2 = 0, D3 = 1)
//
//  Costs are simulated seconds per call. They follow CONTRACT 6: about 1 us
//  per loop back-edge on AVR, 0.2 us on ESP32, digitalWrite 4 us, analogRead
//  112 us on AVR.
//
//  GREP MAP
//    AVR_COSTS / ESP_COSTS ... the time cost table
//    uno328 / nano328 ........ the 328 boards (Uno layout and Nano layout)
//    esp32dev ................ the 30-pin ESP32 devkit
//    BOARDS .................. the export the contract names
//    pinName / pinNumber ..... number <-> name, null when the pin is absent
//    boardOf ................. the BOARDS key for a part def id
// ============================================================================

const AVR_COSTS = { tick: 1e-6, digitalWrite: 4e-6, digitalRead: 4e-6, pinMode: 3e-6, analogRead: 112e-6, analogWrite: 6e-6, call: 0.5e-6 };
const ESP_COSTS = { tick: 0.2e-6, digitalWrite: 0.3e-6, digitalRead: 0.3e-6, pinMode: 1e-6, analogRead: 10e-6, analogWrite: 2e-6, call: 0.1e-6 };

function avrPins(analogCount) {
  const pins = {};
  for (let i = 0; i <= 13; i++) {
    const p = { gpio: i };
    if ([3, 5, 6, 9, 10, 11].includes(i)) { p.pwm = true; p.pwmFreq = (i === 5 || i === 6) ? 980 : 490; }
    if (i === 2) p.int = 0;
    if (i === 3) p.int = 1;
    pins['D' + i] = p;
  }
  for (let i = 0; i < analogCount; i++) {
    const p = { gpio: 14 + i, adc: i };
    if (i >= 6) p.analogOnly = true;      // A6 and A7 of the Nano layout have no digital buffer
    pins['A' + i] = p;
  }
  return pins;
}

function avrBoard(name, analogCount) {
  const analog = {};
  for (let i = 0; i < analogCount; i++) analog['A' + i] = 14 + i;
  return {
    name, family: 'avr', vdd: 5, adcBits: 10, vref: 5, intBits: 16, doubleBits: 32,
    pwmFreq: 490, pwmBits: 8, rout: 25, pullup: 35e3, pinMax: 0.04,
    vih: 0.6, vil: 0.3,
    pins: avrPins(analogCount), led: 'D13',
    alias: { LED_BUILTIN: 'D13', SDA: 'A4', SCL: 'A5', SS: 'D10', MOSI: 'D11', MISO: 'D12', SCK: 'D13' },
    analog, costs: AVR_COSTS, defines: ['ARDUINO_ARCH_AVR', '__AVR__', '__AVR_ATmega328P__']
  };
}

// The ESP32 devkit: 30 pins. Names as the part def prints them.
const ESP_LAYOUT = [
  ['VP', 36], ['VN', 39], ['34', 34], ['35', 35], ['32', 32], ['33', 33], ['25', 25], ['26', 26], ['27', 27],
  ['14', 14], ['12', 12], ['13', 13], ['23', 23], ['22', 22], ['TX0', 1], ['RX0', 3], ['21', 21], ['19', 19],
  ['18', 18], ['5', 5], ['17', 17], ['16', 16], ['4', 4], ['2', 2], ['15', 15]
];
// ADC channels (ADC1 0..7 on 36,37,38,39,32,33,34,35; ADC2 on the rest).
const ESP_ADC = { 36: 0, 39: 3, 32: 4, 33: 5, 34: 6, 35: 7, 4: 10, 2: 12, 15: 13, 13: 14, 12: 15, 14: 16, 27: 17, 25: 18, 26: 19 };

function espPins() {
  const pins = {};
  for (const [name, g] of ESP_LAYOUT) {
    const p = { gpio: g, int: g };
    if (ESP_ADC[g] !== undefined) p.adc = ESP_ADC[g];
    if ([34, 35, 36, 39].includes(g)) p.inputOnly = true; else { p.pwm = true; p.pwmFreq = 1000; }
    pins[name] = p;
  }
  return pins;
}

const esp32dev = {
  name: 'ESP32 devkit', family: 'esp32', vdd: 3.3, adcBits: 12, vref: 3.3, intBits: 32, doubleBits: 64,
  pwmFreq: 1000, pwmBits: 8, rout: 30, pullup: 45e3, pinMax: 0.04,
  vih: 0.75, vil: 0.25,
  pins: espPins(), led: '2',
  alias: { LED_BUILTIN: '2', SDA: '21', SCL: '22', SS: '5', MOSI: '23', MISO: '19', SCK: '18', TX: 'TX0', RX: 'RX0' },
  analog: { A0: 36, A3: 39, A4: 32, A5: 33, A6: 34, A7: 35, A10: 4, A12: 2, A13: 15, A14: 13, A15: 12, A16: 14, A17: 27, A18: 25, A19: 26 },
  inputOnly: [34, 35, 36, 39],
  costs: ESP_COSTS, defines: ['ESP32', 'ARDUINO_ARCH_ESP32']
};

export const BOARDS = {
  uno328: avrBoard('328 Dev Board (Uno layout)', 6),
  nano328: avrBoard('328 Nano-layout board', 8),
  esp32dev
};

// number -> pin name (or null). Cached per board.
const NUM2NAME = new Map();
export function pinName(board, n) {
  const B = typeof board === 'string' ? BOARDS[board] : board;
  if (!B) return null;
  let m = NUM2NAME.get(B);
  if (!m) { m = new Map(); for (const [name, p] of Object.entries(B.pins)) m.set(p.gpio, name); NUM2NAME.set(B, m); }
  return m.get(n) ?? null;
}
export function pinNumber(board, name) {
  const B = typeof board === 'string' ? BOARDS[board] : board;
  const p = B && B.pins[name];
  return p ? p.gpio : null;
}

// The BOARDS key for a part def id (CONTRACT 3.5 ids).
export function boardOf(defId) {
  return { 'mcu-uno': 'uno328', 'mcu-nano': 'nano328', 'mcu-esp32': 'esp32dev' }[defId] || null;
}
