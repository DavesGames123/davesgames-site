// ============================================================================
//  BREADBOARD LAB  ·  mcu/sketches.js — the sketches of the MCU examples
// ----------------------------------------------------------------------------
//  The program text of examples 23-32 (CONTRACT 5) and two starter sketches.
//  INTEGRATE copies these into examples/<key>.json as
//  `programs[partId] = { lang: 'sketch', source: SKETCHES[key].source }`.
//  mcu/tests.mjs compiles every one and runs it against a fake io, so a
//  sketch here is known to do what its `wiring` line says.
//
//  Each entry: { board, wiring, source }. `wiring` names the pins the
//  example doc must connect (pin names as the part defs print them).
//
//  GREP MAP
//    SKETCHES['uno-blink'] ... one entry per example key
//    STARTERS ................ the empty sketch of a new board, per board
// ============================================================================

export const SKETCHES = {
  'uno-blink': {
    board: 'uno328',
    wiring: 'D13 -> 220 ohm -> LED anode; LED cathode -> GND. The on-board L LED is on D13 too.',
    source: `// Blink: the LED on pin 13 is on for half a second, off for half a second.
const int LED = 13;

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  digitalWrite(LED, HIGH);
  delay(500);
  digitalWrite(LED, LOW);
  delay(500);
}
`
  },
  'uno-button-serial': {
    board: 'uno328',
    wiring: 'Button between D2 and GND (no resistor: INPUT_PULLUP). LED on D13 shows the state.',
    source: `// Count button presses with a debounce, and report them on Serial.
const int BUTTON = 2;
const int LED = 13;
const unsigned long DEBOUNCE_MS = 30;

int lastReading = HIGH;
int state = HIGH;
unsigned long lastChange = 0;
int presses = 0;

void setup() {
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
  Serial.println("Ready: press the button");
}

void loop() {
  int reading = digitalRead(BUTTON);
  if (reading != lastReading) {
    lastChange = millis();
    lastReading = reading;
  }
  if (millis() - lastChange >= DEBOUNCE_MS && reading != state) {
    state = reading;
    digitalWrite(LED, state == LOW ? HIGH : LOW);
    if (state == LOW) {
      presses++;
      Serial.print("Press ");
      Serial.println(presses);
    }
  }
}
`
  },
  'uno-fade-pot': {
    board: 'uno328',
    wiring: 'Pot ends to 5V and GND, wiper to A0. D9 -> 220 ohm -> LED -> GND.',
    source: `// The pot sets the LED brightness. Open the plotter to see the reading.
const int POT = A0;
const int LED = 9;

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  int raw = analogRead(POT);          // 0..1023
  int duty = map(raw, 0, 1023, 0, 255);
  analogWrite(LED, duty);
  Serial.print("pot:");
  Serial.print(raw);
  Serial.print(",duty:");
  Serial.println(duty);
  delay(50);
}
`
  },
  'uno-595': {
    board: 'uno328',
    wiring: 'D11 -> 74HC595 DS (14), D12 -> SHCP (11), D8 -> STCP (12). OE (13) to GND, MR (10) to 5V. Q0..Q7 -> 220 ohm -> LEDs.',
    source: `// A light that sweeps across eight LEDs through a 74HC595 shift register.
const int DATA = 11;
const int CLOCK = 12;
const int LATCH = 8;

byte pattern = 1;
int dir = 1;

void show(byte bits) {
  digitalWrite(LATCH, LOW);
  shiftOut(DATA, CLOCK, MSBFIRST, bits);
  digitalWrite(LATCH, HIGH);
}

void setup() {
  pinMode(DATA, OUTPUT);
  pinMode(CLOCK, OUTPUT);
  pinMode(LATCH, OUTPUT);
  show(0);
}

void loop() {
  show(pattern);
  delay(120);
  if (dir > 0) pattern = pattern << 1; else pattern = pattern >> 1;
  if (pattern == 0x80 || pattern == 0x01) dir = -dir;
}
`
  },
  'uno-7seg': {
    board: 'uno328',
    wiring: 'Common-cathode digit: COM -> GND. Segments a..g from D2..D8, each through 220 ohm.',
    source: `// Count 0 to 9 on a single common-cathode 7-segment digit.
const byte SEG_PINS[7] = {2, 3, 4, 5, 6, 7, 8};   // a b c d e f g
const byte DIGITS[10] = {
  0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110,
  0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111
};

void showDigit(int d) {
  for (int s = 0; s < 7; s++) {
    digitalWrite(SEG_PINS[s], bitRead(DIGITS[d], s));
  }
}

void setup() {
  for (int s = 0; s < 7; s++) pinMode(SEG_PINS[s], OUTPUT);
}

void loop() {
  for (int d = 0; d < 10; d++) {
    showDigit(d);
    delay(600);
  }
}
`
  },
  'uno-lcd-thermo': {
    board: 'uno328',
    wiring: 'LCD 4-bit: RS D12, E D11, D4 D5, D5 D4, D6 D3, D7 D2; RW, VSS, K to GND; VDD, A to 5V; V0 to a trimpot wiper. 10 kohm from 5V to A0, thermistor from A0 to GND.',
    source: `// A thermometer: the thermistor reading on a 16x2 LCD.
#include <LiquidCrystal.h>

LiquidCrystal lcd(12, 11, 5, 4, 3, 2);

const float R_FIXED = 10000.0;   // the resistor from 5 V to A0
const float R25 = 10000.0;       // thermistor at 25 C
const float BETA = 3950.0;

float readTempC() {
  int adc = analogRead(A0);
  if (adc <= 0) adc = 1;
  if (adc >= 1023) adc = 1022;
  float r = R_FIXED * adc / (1023.0 - adc);
  float invT = 1.0 / 298.15 + log(r / R25) / BETA;
  return 1.0 / invT - 273.15;
}

void setup() {
  lcd.begin(16, 2);
  lcd.print("Thermometer");
  delay(300);
}

void loop() {
  float t = readTempC();
  lcd.setCursor(0, 0);
  lcd.print("TEMP ");
  lcd.print(t, 1);
  lcd.print(" C     ");
  lcd.setCursor(0, 1);
  lcd.print("ADC ");
  lcd.print(analogRead(A0));
  lcd.print("     ");
  delay(250);
}
`
  },
  'uno-melody': {
    board: 'uno328',
    wiring: 'D8 -> 100 ohm -> passive buzzer + ; buzzer - -> GND.',
    source: `// Play a short tune with tone(), then wait and play it again.
const int BUZZER = 8;

const int NOTE_C4 = 262, NOTE_D4 = 294, NOTE_E4 = 330, NOTE_F4 = 349;
const int NOTE_G4 = 392, NOTE_A4 = 440, NOTE_B4 = 494, NOTE_C5 = 523;

int melody[] = { NOTE_C4, NOTE_E4, NOTE_G4, NOTE_C5, 0, NOTE_G4, NOTE_A4, NOTE_B4, NOTE_C5 };
int beats[]  = { 4, 4, 4, 2, 8, 8, 8, 8, 2 };   // 4 = quarter note

void setup() {
  pinMode(BUZZER, OUTPUT);
}

void loop() {
  int count = sizeof(melody) / sizeof(melody[0]);
  for (int i = 0; i < count; i++) {
    int ms = 1000 / beats[i];
    if (melody[i] > 0) tone(BUZZER, melody[i], ms);
    delay(ms * 13 / 10);
    noTone(BUZZER);
  }
  delay(1500);
}
`
  },
  'uno-servo': {
    board: 'uno328',
    wiring: 'Pot wiper to A0 (ends to 5V and GND). Servo SIG to D9, VCC to 5V, GND to GND.',
    source: `// The pot sets the servo horn angle.
#include <Servo.h>

Servo horn;

void setup() {
  horn.attach(9);
}

void loop() {
  int raw = analogRead(A0);
  int angle = map(raw, 0, 1023, 0, 180);
  horn.write(angle);
  delay(20);
}
`
  },
  'esp32-traffic': {
    board: 'esp32dev',
    wiring: 'GPIO 25 -> 220 ohm -> red LED, GPIO 26 -> 220 ohm -> yellow LED, GPIO 27 -> 220 ohm -> green LED; cathodes to GND.',
    source: `// A traffic light on 3.3 V logic. Serial prints each phase.
const int RED = 25;
const int YELLOW = 26;
const int GREEN = 27;

void light(int r, int y, int g, const char* name, int ms) {
  digitalWrite(RED, r);
  digitalWrite(YELLOW, y);
  digitalWrite(GREEN, g);
  Serial.printf("%-6s %d ms\\n", name, ms);
  delay(ms);
}

void setup() {
  pinMode(RED, OUTPUT);
  pinMode(YELLOW, OUTPUT);
  pinMode(GREEN, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  light(HIGH, LOW, LOW, "RED", 3000);
  light(HIGH, HIGH, LOW, "READY", 1000);
  light(LOW, LOW, HIGH, "GREEN", 3000);
  light(LOW, HIGH, LOW, "AMBER", 1000);
}
`
  },
  'nano-joystick': {
    board: 'nano328',
    wiring: 'Joystick VRX to A0, VRY to A1, +5V to 5V, GND to GND, SW to D2. D5 -> 220 ohm -> LED X, D6 -> 220 ohm -> LED Y.',
    source: `// Two LEDs follow the joystick: brightness = distance from the centre.
const int VRX = A0, VRY = A1, SW = 2;
const int LED_X = 5, LED_Y = 6;

int level(int raw) {
  int d = abs(raw - 512);          // 0 at the centre
  return constrain(d / 2, 0, 255);
}

void setup() {
  pinMode(SW, INPUT_PULLUP);
  pinMode(LED_X, OUTPUT);
  pinMode(LED_Y, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int x = analogRead(VRX), y = analogRead(VRY);
  bool pressed = digitalRead(SW) == LOW;
  analogWrite(LED_X, pressed ? 255 : level(x));
  analogWrite(LED_Y, pressed ? 255 : level(y));
  delay(20);
}
`
  }
};

export const STARTERS = {
  uno328: `void setup() {
  // runs once
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  // runs again and again
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000);
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000);
}
`,
  nano328: null,
  esp32dev: null
};
STARTERS.nano328 = STARTERS.uno328;
STARTERS.esp32dev = STARTERS.uno328.replace('void setup() {', 'void setup() {\n  Serial.begin(115200);');
