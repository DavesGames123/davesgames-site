// ============================================================================
//  BREADBOARD LAB  ·  examples/index.js — the example list (written by build.mjs)
// ----------------------------------------------------------------------------
//  Do not edit by hand: run node examples/build.mjs. EXAMPLES holds the meta
//  of each example in CONTRACT 5 order; load(key) fetches its JSON file.
//  ui.examples(list()) takes { meta, load } entries.
//
//  GREP MAP
//    EXAMPLES ........ key, title, level, blurb, see
//    exampleUrl ...... the JSON file of a key
//    loadExample ..... fetch and parse one example ({ meta, doc })
//    list ............ the entries for the EXAMPLES panel
// ============================================================================
export const EXAMPLES = [
 {
  "key": "first-led",
  "title": "First LED",
  "level": 1,
  "blurb": "A 5 V supply, a 220 Ω resistor and a red LED, with the multimeter in series to read the current.",
  "see": [
   "The LED glows red.",
   "The multimeter in A mode reads about 13.6 mA: (5 V − 2 V) / 220 Ω.",
   "Turn the supply up and the current rises; past about 50 mA the LED burns."
  ]
 },
 {
  "key": "no-resistor",
  "title": "LED with no resistor",
  "level": 1,
  "blurb": "A red LED straight across a 9 V battery. Nothing limits the current, so the LED dies.",
  "see": [
   "The LED flashes very bright for a moment.",
   "Smoke rises, the LED goes dark and chars, and a toast names the missing resistor.",
   "Click \"Replace part\", add a 470 Ω resistor in series, and run again."
  ]
 },
 {
  "key": "ohms-law",
  "title": "Ohm's law",
  "level": 1,
  "blurb": "A 1 kΩ and a 2 kΩ resistor in series across 9 V, and two 2.2 kΩ resistors in parallel on their own.",
  "see": [
   "Meter 1 (V) across the 2 kΩ reads 6.00 V: 9 V × 2k / (1k + 2k).",
   "Meter 2 (Ω) across the parallel pair reads 1.10 kΩ: half of 2.2 kΩ.",
   "Move meter 2 onto the powered pair and it reads OL: an ohmmeter works only with the power off."
  ]
 },
 {
  "key": "divider-pot",
  "title": "Pot as a divider and a rheostat",
  "level": 1,
  "blurb": "One pot divides 5 V for the meter; a second pot is a variable resistor in series with an LED.",
  "see": [
   "The meter reads the wiper voltage: 2.50 V at mid travel. Turn the left knob and it follows.",
   "The right pot sets the LED current: near 0 it is bright, near the middle it is dim."
  ]
 },
 {
  "key": "button-pulldown",
  "title": "Button with a pull-down",
  "level": 1,
  "blurb": "A push button feeds 5 V to an LED; a 10 kΩ pull-down holds the line low when the button is up.",
  "see": [
   "Click and hold the button cap: the LED lights.",
   "Let go: the 10 kΩ pull-down takes the line back to 0 V and the LED goes out.",
   "Probe the button output with P to see 0 V and 5 V."
  ]
 },
 {
  "key": "rc-charge",
  "title": "RC charge curve",
  "level": 1,
  "blurb": "10 kΩ and 100 µF: τ = RC = 1 s. Slide the switch to charge the capacitor and watch the curve on the scope.",
  "see": [
   "Slide the switch: the scope trace rises fast, then slower and slower.",
   "After τ = 1 s the capacitor holds 63 % of 5 V (3.16 V); put a cursor there.",
   "Slide back to discharge it through the same resistor."
  ]
 },
 {
  "key": "night-light",
  "title": "Night light",
  "level": 1,
  "blurb": "A light sensor and a resistor divide 5 V; in the dark the divider turns on an NPN transistor and a white LED.",
  "see": [
   "In room light (300 lx) the LED is off.",
   "Drag the LDR light slider down to 1 lx: the base voltage rises, the transistor turns on and the LED lights."
  ]
 },
 {
  "key": "transistor-motor",
  "title": "Transistor motor switch",
  "level": 2,
  "blurb": "An NPN transistor switches a DC motor from a slide switch. A diode across the motor catches the spike when it turns off.",
  "see": [
   "Slide the switch: the motor spins up.",
   "Slide it back: the scope shows the collector rise to about 5.7 V, held by the diode.",
   "Delete the diode and switch off again: the collector spikes far above the supply."
  ]
 },
 {
  "key": "blink-555",
  "title": "555 blinker",
  "level": 2,
  "blurb": "A 555 timer in astable mode: 1 kΩ, 51 kΩ and 10 µF make about 1.4 Hz. Two LEDs take turns.",
  "see": [
   "The red and green LEDs swap about 1.4 times a second.",
   "Scope channel 1 shows the capacitor ramp between 1/3 and 2/3 of 5 V (1.67 V and 3.33 V).",
   "Channel 2 shows the square output; change R2 or C to change the rate."
  ]
 },
 {
  "key": "tone-555",
  "title": "555 tone generator",
  "level": 2,
  "blurb": "The 555 runs at audio rate and drives a passive buzzer. A pot in the timing chain sets the pitch.",
  "see": [
   "A tone of about 1108 Hz plays (press run and unmute).",
   "Turn the pot down and the pitch rises: f = 1.44 / ((R1 + 2·R2) · C).",
   "At 20 % travel it is about 2057 Hz."
  ]
 },
 {
  "key": "zener-reg",
  "title": "Zener regulator",
  "level": 2,
  "blurb": "A 5.1 V zener and a 220 Ω resistor hold a load at about 5.1 V from 9 V.",
  "see": [
   "The meter reads about 5.1 V across the load.",
   "Change the load from 1 kΩ to 470 Ω: the zener current falls, the voltage hardly moves.",
   "Try 100 Ω: the zener runs out of current and the voltage drops."
  ]
 },
 {
  "key": "reg-7805",
  "title": "7805 regulator",
  "level": 2,
  "blurb": "A 9 V battery through a 7805 linear regulator gives a steady 5 V rail for two LEDs.",
  "see": [
   "The meter on the output rail reads 5.00 V.",
   "The battery charge falls slowly while it runs (see the inspector).",
   "Set the battery charge to 0: its voltage sags to about 6 V, below the 7 V the 7805 needs, and the output drops out."
  ]
 },
 {
  "key": "opamp-amp",
  "title": "Op-amp amplifier, gain 11",
  "level": 2,
  "blurb": "An LM358 as a non-inverting amplifier on one 9 V supply: Rf 10 kΩ over Rg 1 kΩ gives a gain of 11.",
  "see": [
   "Channel 1: 0.2 V peak to peak in. Channel 2: 2.2 V peak to peak out, in phase.",
   "The 10 µF capacitor keeps the DC gain at 1, so the output sits at the 2.5 V input level.",
   "Raise the generator amplitude past about 0.4 V: the output flattens at the LM358 rails."
  ]
 },
 {
  "key": "rc-lowpass",
  "title": "RC low-pass filter",
  "level": 2,
  "blurb": "1 kΩ and 100 nF make a low-pass filter with a corner at fc = 1/(2πRC) ≈ 1592 Hz. The generator sits right at fc.",
  "see": [
   "At fc the output (channel 2) is 0.707 of the input: −3 dB.",
   "The output lags the input by 45°: a quarter of the way to the next peak is one eighth of a period.",
   "Turn the frequency up ten times: the output falls to about 0.1 and the lag nears 90°."
  ]
 },
 {
  "key": "thermostat",
  "title": "Thermostat fan",
  "level": 3,
  "blurb": "A thermistor divider and a set-point trimmer feed an LM358 comparator. Above the set point it switches a fan through an NPN transistor.",
  "see": [
   "At 25 °C the thermistor input (2.5 V) is below the 2.9 V set point: the fan is still.",
   "Drag the thermistor temperature to 40 °C: the input passes the set point, the comparator output goes high and the fan spins.",
   "Turn the set-point trimmer to change the switching temperature."
  ]
 },
 {
  "key": "logic-gates",
  "title": "AND and OR gates",
  "level": 2,
  "blurb": "Two slide switches feed a 74HC08 (AND) and a 74HC32 (OR). The unused gate inputs are tied low, as they should be.",
  "see": [
   "Flip A and B through 00, 10, 11, 01: the green LED (AND) lights only for 11; the blue LED (OR) for all but 00.",
   "The logic analyzer draws A, B, AND and OR as four timing rows: a truth table in time."
  ]
 },
 {
  "key": "chaser-4017",
  "title": "4017 LED chaser",
  "level": 3,
  "blurb": "A 555 clock (about 4.8 Hz) steps a CD4017 decade counter; ten LEDs light one after another.",
  "see": [
   "A single light runs along the ten LEDs and starts again.",
   "The analyzer shows the clock on D0 and Q0 to Q3 on D1 to D4: each Q is high for one clock in ten.",
   "The 4017 outputs are weak (about 400 Ω), which limits each LED to a few mA here; a real build adds a resistor."
  ]
 },
 {
  "key": "flipflop-74",
  "title": "D flip-flop divides by two",
  "level": 2,
  "blurb": "A 74HC74 with its Q̅ output fed back to D toggles on each rising clock edge. The clock is a push button with a pull-down.",
  "see": [
   "Click the button cap: the LED toggles on each press.",
   "The analyzer shows the clock on D0 and Q on D1: Q has one edge per press, so it runs at half the clock rate."
  ]
 },
 {
  "key": "relay-lamp",
  "title": "Relay switches a lamp",
  "level": 3,
  "blurb": "An NPN transistor drives a 5 V relay coil; the relay contacts switch a 6 V lamp on its own battery. A diode clamps the coil.",
  "see": [
   "Slide the switch: the relay clicks and the lamp lights.",
   "The lamp current flows only in the 6 V loop: the 5 V side never carries it.",
   "Slide back: the relay drops out and the diode catches the coil spike."
  ]
 },
 {
  "key": "mosfet-pwm",
  "title": "PWM motor speed",
  "level": 3,
  "blurb": "A 555 with two steering diodes makes PWM at a fixed rate; the pot sets the duty. A logic-level MOSFET switches the motor.",
  "see": [
   "The scope shows the 555 output: a square wave whose high time follows the pot.",
   "Turn the pot from 30 % to 80 %: the duty rises and the motor speeds up.",
   "The diode across the motor carries its current between pulses."
  ]
 },
 {
  "key": "cc-limit",
  "title": "Current limit saves the day",
  "level": 2,
  "blurb": "The bench supply is set to 5 V with a 100 mA limit. The red button shorts the rail to ground.",
  "see": [
   "Hold the red button: the supply drops into CC mode, the CC lamp lights and the display reads 0.100 A at almost 0 V.",
   "The LED goes dark, but nothing burns: the limit holds the current.",
   "Let go: the rail comes back to 5 V."
  ]
 },
 {
  "key": "reverse-cap",
  "title": "Reversed electrolytic",
  "level": 2,
  "blurb": "A 100 µF electrolytic in backwards: its + lead on ground, its − lead (the stripe) on 9 V.",
  "see": [
   "For a moment nothing happens.",
   "Then the capacitor vents: smoke, a burst top, and a toast that says it was reversed.",
   "Electrolytics have a + and a − lead: the stripe marks −."
  ]
 },
 {
  "key": "uno-blink",
  "title": "Blink",
  "level": 1,
  "blurb": "The first sketch: pin 13 drives an LED through 220 Ω, half a second on, half a second off.",
  "see": [
   "The red LED and the on-board L LED blink together at 1 Hz.",
   "Open CODE to read the sketch; change delay(500) to delay(100) and compile: it blinks faster."
  ]
 },
 {
  "key": "uno-button-serial",
  "title": "Button and serial monitor",
  "level": 2,
  "blurb": "A button on pin 2 with the internal pull-up (INPUT_PULLUP), a 30 ms debounce in code, and a count on Serial.",
  "see": [
   "Open CODE and the serial monitor: \"Ready\" prints at start.",
   "Each click of the button prints \"Press 1\", \"Press 2\" and so on; the L LED shows the button state.",
   "No resistor is needed: the pin pulls itself up to 5 V and the button pulls it to ground."
  ]
 },
 {
  "key": "uno-fade-pot",
  "title": "Pot fades an LED",
  "level": 2,
  "blurb": "analogRead on A0 reads the pot (0 to 1023); analogWrite on pin 9 sets the LED brightness by PWM.",
  "see": [
   "Turn the pot: the LED brightness follows it.",
   "Open the serial plotter: the line follows the reading.",
   "A logic analyzer on pin 9 would show 490 Hz pulses whose width follows the pot."
  ]
 },
 {
  "key": "uno-595",
  "title": "Shift register scanner",
  "level": 3,
  "blurb": "Three pins drive eight LEDs through a 74HC595: shiftOut clocks a byte in, the latch shows it.",
  "see": [
   "A single light sweeps back and forth across the eight LEDs.",
   "The analyzer shows data (D0), the shift clock (D1, eight pulses per byte) and the latch (D2, once per step)."
  ]
 },
 {
  "key": "uno-7seg",
  "title": "7-segment counter",
  "level": 2,
  "blurb": "Seven pins light the seven segments of a common-cathode digit, each through its own 220 Ω resistor. The sketch counts 0 to 9.",
  "see": [
   "The digit counts 0, 1, 2 … 9 and starts again, a step every 0.6 s.",
   "Each segment is an LED: a table of bit patterns in the sketch says which ones light for each digit."
  ]
 },
 {
  "key": "uno-lcd-thermo",
  "title": "LCD thermometer",
  "level": 3,
  "blurb": "A 10 kΩ NTC thermistor divider on A0; the sketch turns the reading into °C and prints it on a 16 × 2 LCD in 4-bit mode.",
  "see": [
   "The LCD shows \"TEMP 23.4 C\".",
   "Drag the thermistor temperature: the reading follows within a second.",
   "The contrast trimmer sets V0; turn it up and the text fades."
  ]
 },
 {
  "key": "uno-melody",
  "title": "Melody with tone()",
  "level": 2,
  "blurb": "tone() drives a passive buzzer through 100 Ω: an arpeggio C E G C, a rest, and a run up to C again.",
  "see": [
   "Press run and unmute: the tune plays through the speakers, then repeats after a pause.",
   "The inspector shows the buzzer frequency of each note: 262, 330, 392, 523 Hz …"
  ]
 },
 {
  "key": "uno-servo",
  "title": "Pot steers a servo",
  "level": 2,
  "blurb": "The pot reading on A0 maps to 0–180°; the Servo library sends a 50 Hz pulse of 0.54–2.4 ms on pin 9.",
  "see": [
   "Turn the pot: the servo horn follows it.",
   "At 20 % travel the horn sits at about 36°, at 80 % about 144°."
  ]
 },
 {
  "key": "esp32-traffic",
  "title": "ESP32 traffic light",
  "level": 3,
  "blurb": "A 30-pin ESP32 devkit on 3.3 V logic runs a traffic light on GPIO 25, 26 and 27. Its rows sit in b and i, so a and j stay free for wires.",
  "see": [
   "Red for 3 s, red and amber for 1 s, green for 3 s, amber for 1 s, then again.",
   "The meter on GPIO 25 reads about 3.2 V when it is high: 3.3 V logic, not 5 V.",
   "The serial monitor names each phase."
  ]
 },
 {
  "key": "nano-joystick",
  "title": "Joystick and PWM LEDs",
  "level": 3,
  "blurb": "A Nano-layout board reads a two-axis joystick on A0 and A1 and sets two LEDs by PWM: brightness is the distance from centre.",
  "see": [
   "At rest both LEDs are dark.",
   "Push the stick along X: the green LED brightens, the blue one stays dark. Y works the same way.",
   "Press the stick (SW): both LEDs go full on."
  ]
 }
];

export const exampleUrl = key => new URL(`./${key}.json`, import.meta.url).href;

export async function loadExample(key) {
  const r = await fetch(exampleUrl(key));
  if (!r.ok) throw new Error(`example ${key}: HTTP ${r.status}`);
  return r.json();
}

export const list = () => EXAMPLES.map(meta => ({ meta, load: () => loadExample(meta.key) }));
