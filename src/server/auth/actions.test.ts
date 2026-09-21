import { describe, expect, it, vi, beforeEach } from "vitest";

const signUpMock = vi.fn();
const signInWithPasswordMock = vi.fn();
const signOutMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      signUp: signUpMock,
      signInWithPassword: signInWithPasswordMock,
      signOut: signOutMock,
    },
  })),
}));

class RedirectSignal extends Error {
  constructor(public target: string) {
    super("NEXT_REDIRECT");
  }
}
const redirect = vi.fn((target: string) => {
  throw new RedirectSignal(target);
});
vi.mock("next/navigation", () => ({ redirect }));

const { signIn, signUp, signOut } = await import("./actions");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  signUpMock.mockReset();
  signInWithPasswordMock.mockReset();
  signOutMock.mockReset();
  redirect.mockClear();
});

describe("signUp action", () => {
  const validFields = {
    fullName: "Alice Buyer",
    email: "Alice@Example.com",
    password: "correcthorse",
    confirmPassword: "correcthorse",
  };

  it("rejects invalid input before ever calling Supabase", async () => {
    const result = await signUp(null, formData({ ...validFields, confirmPassword: "different" }));
    expect(result).toEqual({ error: expect.any(String) });
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("calls supabase.auth.signUp with normalized email and full_name metadata, no user id", async () => {
    signUpMock.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });

    await expect(signUp(null, formData(validFields))).rejects.toThrow(RedirectSignal);

    expect(signUpMock).toHaveBeenCalledWith({
      email: "alice@example.com",
      password: "correcthorse",
      options: { data: { full_name: "Alice Buyer" } },
    });
    const call = signUpMock.mock.calls[0][0];
    expect(call).not.toHaveProperty("id");
    expect(call.options.data).not.toHaveProperty("id");
    expect(call.options.data).not.toHaveProperty("role");
  });

  it("redirects to /account by default when signup returns an active session (email confirmation not required)", async () => {
    signUpMock.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    await expect(signUp(null, formData(validFields))).rejects.toThrow(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith("/account");
  });

  it("redirects to a safe ?next= target when provided and a session was created", async () => {
    signUpMock.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    await expect(signUp(null, formData({ ...validFields, next: "/account/orders" }))).rejects.toThrow(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith("/account/orders");
  });

  it("ignores an unsafe ?next= target and falls back to /account", async () => {
    signUpMock.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    await expect(
      signUp(null, formData({ ...validFields, next: "https://evil.example.com" })),
    ).rejects.toThrow(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith("/account");
  });

  it("Phase 5: does NOT redirect when signup returns no session (email confirmation pending) — reports confirmationSent instead", async () => {
    signUpMock.mockResolvedValue({ data: { session: null }, error: null });
    const result = await signUp(null, formData(validFields));
    expect(result).toEqual({ confirmationSent: true });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("surfaces a Supabase error without redirecting", async () => {
    signUpMock.mockResolvedValue({ data: { session: null }, error: { message: "User already registered" } });
    const result = await signUp(null, formData(validFields));
    expect(result).toEqual({ error: "User already registered" });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("signIn action", () => {
  const validFields = { email: "bob@example.com", password: "anything" };

  it("rejects invalid input before ever calling Supabase", async () => {
    const result = await signIn(null, formData({ email: "not-an-email", password: "x" }));
    expect(result).toEqual({ error: expect.any(String) });
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  it("redirects to /account on success", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    await expect(signIn(null, formData(validFields))).rejects.toThrow(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith("/account");
  });

  it("returns a generic error on failure — never confirms which field was wrong", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    const result = await signIn(null, formData(validFields));
    expect(result).toEqual({ error: "Incorrect email or password." });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("signOut action", () => {
  it("signs out and redirects home", async () => {
    signOutMock.mockResolvedValue({ error: null });
    await expect(signOut()).rejects.toThrow(RedirectSignal);
    expect(signOutMock).toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/");
  });
});
