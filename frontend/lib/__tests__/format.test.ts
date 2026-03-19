import { describe, it, expect } from "vitest";
import { formatCompactNumber, formatPercent } from "../format";

describe("formatCompactNumber", () => {
  it("returns raw number for values under 1000", () => {
    expect(formatCompactNumber(0)).toBe("0");
    expect(formatCompactNumber(1)).toBe("1");
    expect(formatCompactNumber(42)).toBe("42");
    expect(formatCompactNumber(999)).toBe("999");
  });

  it("formats thousands with K suffix", () => {
    expect(formatCompactNumber(1000)).toBe("1K");
    expect(formatCompactNumber(1500)).toBe("1.5K");
    expect(formatCompactNumber(2000)).toBe("2K");
    expect(formatCompactNumber(10000)).toBe("10K");
    expect(formatCompactNumber(999999)).toBe("1000.0K");
  });

  it("formats millions with M suffix", () => {
    expect(formatCompactNumber(1000000)).toBe("1M");
    expect(formatCompactNumber(1500000)).toBe("1.5M");
    expect(formatCompactNumber(25000000)).toBe("25M");
    expect(formatCompactNumber(999999999)).toBe("1000.0M");
  });

  it("formats billions with B suffix", () => {
    expect(formatCompactNumber(1000000000)).toBe("1B");
    expect(formatCompactNumber(98202301000)).toBe("98.2B");
    expect(formatCompactNumber(2500000000)).toBe("2.5B");
  });

  it("omits decimal for exact divisions", () => {
    expect(formatCompactNumber(2000)).toBe("2K");
    expect(formatCompactNumber(5000000)).toBe("5M");
    expect(formatCompactNumber(3000000000)).toBe("3B");
  });

  it("rounds to one decimal place", () => {
    expect(formatCompactNumber(1234)).toBe("1.2K");
    expect(formatCompactNumber(1567000)).toBe("1.6M");
  });
});

describe("formatPercent", () => {
  it("converts basis points to percentage string", () => {
    expect(formatPercent(5000)).toBe("50.0%");
    expect(formatPercent(10000)).toBe("100.0%");
    expect(formatPercent(0)).toBe("0.0%");
  });

  it("handles fractional percentages", () => {
    expect(formatPercent(6667)).toBe("66.7%");
    expect(formatPercent(3333)).toBe("33.3%");
    expect(formatPercent(1)).toBe("0.0%");
    expect(formatPercent(50)).toBe("0.5%");
  });

  it("handles values above 100%", () => {
    expect(formatPercent(15000)).toBe("150.0%");
  });
});
