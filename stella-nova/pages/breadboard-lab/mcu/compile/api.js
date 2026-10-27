// ============================================================================
//  BREADBOARD LAB  ·  mcu/compile/api.js — the Arduino API tables
// ----------------------------------------------------------------------------
//  Each entry is [kind, ret, min, max]. kind g: a generator (yield*), f: a
//  plain call, other kinds have their own codegen in gen-calls.js. ret
//  'INT'/'UINT'/'DBL' resolve per board (Gen.resolveRet).
//
//  grep -n targets
//    SERIAL_M ............. Serial methods
//    LCD_M ................ LiquidCrystal methods
//    SERVO_M .............. Servo methods
//    STRING_M ............. String methods
//    BUILTINS ............. the free functions
//    MATH / MATH_ARGS ..... math.h -> JS
// ============================================================================
export const SERIAL_M = {
  begin: ['g', 'void', 1, 2], end: ['g', 'void', 0, 0], print: ['print'], println: ['print'], write: ['write'], printf: ['printf'],
  available: ['f', 'INT', 0, 0], availableForWrite: ['f', 'INT', 0, 0], read: ['f', 'INT', 0, 0], peek: ['f', 'INT', 0, 0],
  flush: ['g', 'void', 0, 0], parseInt: ['g', 'i32', 0, 0], parseFloat: ['g', 'f32', 0, 0], readString: ['g', 'String', 0, 0],
  readStringUntil: ['g', 'String', 1, 1], setTimeout: ['f', 'void', 1, 1], find: ['g', 'bool', 1, 1]
};
export const LCD_M = {
  begin: ['g', 'void', 2, 3], clear: ['g', 'void', 0, 0], home: ['g', 'void', 0, 0], setCursor: ['g', 'void', 2, 2],
  print: ['print'], write: ['write'], cursor: ['g', 'void', 0, 0], noCursor: ['g', 'void', 0, 0], blink: ['g', 'void', 0, 0], noBlink: ['g', 'void', 0, 0],
  display: ['g', 'void', 0, 0], noDisplay: ['g', 'void', 0, 0], scrollDisplayLeft: ['g', 'void', 0, 0], scrollDisplayRight: ['g', 'void', 0, 0],
  leftToRight: ['g', 'void', 0, 0], rightToLeft: ['g', 'void', 0, 0], autoscroll: ['g', 'void', 0, 0], noAutoscroll: ['g', 'void', 0, 0],
  createChar: ['g', 'void', 2, 2], command: ['g', 'void', 1, 1]
};
export const SERVO_M = {
  attach: ['g', 'u8', 1, 3], detach: ['g', 'void', 0, 0], write: ['g', 'void', 1, 1], writeMicroseconds: ['g', 'void', 1, 1],
  read: ['f', 'INT', 0, 0], readMicroseconds: ['f', 'INT', 0, 0], attached: ['f', 'bool', 0, 0]
};
// String methods: [kind, ret, min, max]; kind 'm' mutates the String in place
export const STRING_M = {
  length: ['f', 'UINT', 0, 0], charAt: ['f', 'char', 1, 1], substring: ['f', 'String', 1, 2], indexOf: ['f', 'INT', 1, 2], lastIndexOf: ['f', 'INT', 1, 2],
  toInt: ['f', 'i32', 0, 0], toFloat: ['f', 'f32', 0, 0], toDouble: ['f', 'DBL', 0, 0], equals: ['f', 'bool', 1, 1], equalsIgnoreCase: ['f', 'bool', 1, 1],
  startsWith: ['f', 'bool', 1, 1], endsWith: ['f', 'bool', 1, 1], compareTo: ['f', 'INT', 1, 1], c_str: ['f', 'cstr', 0, 0], isEmpty: ['f', 'bool', 0, 0],
  concat: ['m', 'bool', 1, 1], toUpperCase: ['m', 'void', 0, 0], toLowerCase: ['m', 'void', 0, 0], trim: ['m', 'void', 0, 0],
  replace: ['m', 'void', 2, 2], remove: ['m', 'void', 1, 2], setCharAt: ['m', 'void', 2, 2], reserve: ['f', 'bool', 1, 1]
};
// Built-in functions: [kind, ret, min, max]. g: generator (yield*), f: plain.
// ret 'INT'/'UINT'/'DBL' resolve per board. Special codegen: see genBuiltin.
export const BUILTINS = {
  pinMode: ['g', 'void', 2, 2], digitalWrite: ['g', 'void', 2, 2], digitalRead: ['g', 'INT', 1, 1], analogRead: ['g', 'INT', 1, 1],
  analogWrite: ['g', 'void', 2, 2], delay: ['g', 'void', 1, 1], delayMicroseconds: ['g', 'void', 1, 1], tone: ['g', 'void', 2, 3],
  noTone: ['g', 'void', 1, 1], pulseIn: ['g', 'u32', 2, 3], pulseInLong: ['g', 'u32', 2, 3], shiftOut: ['g', 'void', 4, 4], shiftIn: ['g', 'u8', 3, 3],
  yield: ['g', 'void', 0, 0], millis: ['f', 'u32', 0, 0], micros: ['f', 'u32', 0, 0], map: ['f', 'i32', 5, 5], random: ['f', 'i32', 1, 2],
  randomSeed: ['f', 'void', 1, 1], attachInterrupt: ['f', 'void', 3, 3], detachInterrupt: ['f', 'void', 1, 1], digitalPinToInterrupt: ['f', 'INT', 1, 1],
  interrupts: ['f', 'void', 0, 0], noInterrupts: ['f', 'void', 0, 0], sei: ['f', 'void', 0, 0], cli: ['f', 'void', 0, 0],
  analogReadResolution: ['f', 'void', 1, 1], analogWriteResolution: ['f', 'void', 1, 1],
  ledcAttach: ['f', 'bool', 3, 3], ledcSetup: ['f', 'u32', 3, 3], ledcAttachPin: ['f', 'void', 2, 2], ledcWrite: ['g', 'bool', 2, 2],
  ledcWriteTone: ['g', 'u32', 2, 2], ledcDetach: ['g', 'bool', 1, 1], ledcDetachPin: ['g', 'void', 1, 1],
  word: ['f', 'u16', 1, 2], isDigit: ['f', 'bool', 1, 1], isAlpha: ['f', 'bool', 1, 1], isAlphaNumeric: ['f', 'bool', 1, 1], isSpace: ['f', 'bool', 1, 1],
  isWhitespace: ['f', 'bool', 1, 1], isUpperCase: ['f', 'bool', 1, 1], isLowerCase: ['f', 'bool', 1, 1], isPunct: ['f', 'bool', 1, 1], isHexadecimalDigit: ['f', 'bool', 1, 1],
  isPrintable: ['f', 'bool', 1, 1], toupper: ['f', 'INT', 1, 1], tolower: ['f', 'INT', 1, 1],
  strlen: ['f', 'UINT', 1, 1], strcmp: ['f', 'INT', 2, 2], sprintf: ['sprintf'], snprintf: ['sprintf'], dtostrf: ['dtostrf'],
  atoi: ['f', 'INT', 1, 1], atol: ['f', 'i32', 1, 1], atof: ['f', 'DBL', 1, 1],
  sqrt: ['math'], pow: ['math'], sin: ['math'], cos: ['math'], tan: ['math'], asin: ['math'], acos: ['math'], atan: ['math'], atan2: ['math'],
  exp: ['math'], log: ['math'], log10: ['math'], floor: ['math'], ceil: ['math'], fabs: ['math'], fmod: ['math'], fmin: ['math'], fmax: ['math'],
  trunc: ['math'], hypot: ['math'], round: ['math'], sinh: ['math'], cosh: ['math'], tanh: ['math'], cbrt: ['math'], square: ['math'],
  sqrtf: ['math'], powf: ['math'], sinf: ['math'], cosf: ['math'], fabsf: ['math'], roundf: ['math'], floorf: ['math'], ceilf: ['math'],
  isnan: ['f', 'bool', 1, 1], isinf: ['f', 'bool', 1, 1],
  min: ['macro'], max: ['macro'], constrain: ['macro'], abs: ['macro'], sq: ['macro'], bitRead: ['macro'], bitSet: ['macro'], bitClear: ['macro'],
  bitWrite: ['macro'], bit: ['macro'], lowByte: ['macro'], highByte: ['macro'], F: ['macro'], PSTR: ['macro'],
  pgm_read_byte: ['pgm'], pgm_read_word: ['pgm'], pgm_read_dword: ['pgm'], pgm_read_float: ['pgm'], pgm_read_byte_near: ['pgm'], pgm_read_word_near: ['pgm']
};
export const MATH = {
  sqrt: 'Math.sqrt', pow: 'Math.pow', sin: 'Math.sin', cos: 'Math.cos', tan: 'Math.tan', asin: 'Math.asin', acos: 'Math.acos', atan: 'Math.atan', atan2: 'Math.atan2',
  exp: 'Math.exp', log: 'Math.log', log10: 'Math.log10', floor: 'Math.floor', ceil: 'Math.ceil', fabs: 'Math.abs', fmod: '$.fmod', fmin: 'Math.min', fmax: 'Math.max',
  trunc: 'Math.trunc', hypot: 'Math.hypot', round: '$.round', sinh: 'Math.sinh', cosh: 'Math.cosh', tanh: 'Math.tanh', cbrt: 'Math.cbrt', square: '$.square',
  sqrtf: 'Math.sqrt', powf: 'Math.pow', sinf: 'Math.sin', cosf: 'Math.cos', fabsf: 'Math.abs', roundf: '$.round', floorf: 'Math.floor', ceilf: 'Math.ceil'
};
export const MATH_ARGS = { pow: 2, atan2: 2, fmod: 2, fmin: 2, fmax: 2, hypot: 2, powf: 2 };
