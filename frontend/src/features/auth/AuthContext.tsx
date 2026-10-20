import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { SESSION_EXPIRED_EVENT, tokenStore } from "@/api/client";
import { authApi } from "@/api/endpoints";
import type { Capability, Me, Role } from "@/types/api";

interface AuthState {
  user: Me | null;
  initializing: boolean;
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  can: (capability: Capability) => boolean;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<Me | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Restore the session from stored tokens on first load.
  useEffect(() => {
    let cancelled = false;
    if (!tokenStore.get()) {
      setInitializing(false);
      return;
    }
    authApi
      .me()
      .then((me) => !cancelled && setUser(me))
      .catch(() => tokenStore.clear())
      .finally(() => !cancelled && setInitializing(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setSessionExpired(true);
      queryClient.clear();
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [queryClient]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await authApi.login(email, password);
      tokenStore.set({ access: data.access, refresh: data.refresh });
      queryClient.clear();
      setSessionExpired(false);
      setUser(data.user);
      return data.user;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    const tokens = tokenStore.get();
    try {
      if (tokens?.refresh) await authApi.logout(tokens.refresh);
    } catch {
      // Server-side logout is best effort; local tokens are always cleared.
    }
    tokenStore.clear();
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  const refreshUser = useCallback(async () => setUser(await authApi.me()), []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      initializing,
      sessionExpired,
      login,
      logout,
      refreshUser,
      can: (capability) => !!user?.capabilities.includes(capability),
      hasRole: (...roles) => !!user && roles.includes(user.role),
    }),
    [user, initializing, sessionExpired, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
