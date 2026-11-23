/**
 * A JSON.parse reviver for request bodies that refuses any "__proto__" key. JSON.parse keeps such a
 * key as ordinary data, but copying the body into a DTO (class-transformer, including the copy the
 * ValidationPipe hands to controllers) drops it without a trace. A Condition such as
 * { "status": "open", "__proto__": { … } } would then lose part of itself and widen its
 * Permission. No request has a legitimate use for the key, so the body is rejected with a 400.
 */
export function rejectPrototypeKeys(key: string, value: unknown): unknown {
  if (key === '__proto__') throw new SyntaxError('"__proto__" is not allowed as a key in request bodies');
  return value;
}
