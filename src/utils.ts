export const hexWithout0x = (hex: string): string => {
    return hex.slice(2, hex.length);
};

export const strToUint8Array = (str: string): Uint8Array => {
    return new TextEncoder().encode(str);
  };