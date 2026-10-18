import NetInfo from '@react-native-community/netinfo';
import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createQueryClient, useSettle } from '@/hooks/queries';
import { useT } from '@/hooks/useT';
import { getServices } from '@/services/app';
import { useSettings } from '@/state/settings';
import { StateView } from '@/ui/components/states';
import { colors } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)));

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, primary: colors.accent, background: colors.bg, card: colors.bg, text: colors.text, border: colors.border },
};

function useSettingsHydrated() {
  return useSyncExternalStore(
    (onChange) => useSettings.persist.onFinishHydration(onChange),
    () => useSettings.persist.hasHydrated(),
  );
}

/** One-off work after start-up: settle finished predictions (no polling). */
function StartupTasks() {
  const settle = useSettle();
  useEffect(() => {
    settle.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function StorageError({ message }: { message: string }) {
  const { t } = useT();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
      <StateView icon="warning" tone="danger" title={t('error.storage')} message={message} />
    </View>
  );
}

function Navigator() {
  const { t } = useT();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        contentStyle: { backgroundColor: colors.bg },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="match/[id]" options={{ title: t('nav.match') }} />
      <Stack.Screen name="slip" options={{ title: t('nav.slip'), presentation: 'modal' }} />
      <Stack.Screen name="performance" options={{ title: t('nav.performance') }} />
      <Stack.Screen name="providers" options={{ title: t('nav.providers') }} />
      <Stack.Screen name="slips/[id]" options={{ title: t('nav.savedSlip') }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [client] = useState(createQueryClient);
  const hydrated = useSettingsHydrated();
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    getServices()
      .then(() => setDbReady(true))
      .catch((e: unknown) => setDbError(e instanceof Error ? e.message : String(e)));
  }, []);

  const ready = hydrated && (dbReady || !!dbError);
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <ThemeProvider value={navTheme}>
          <StatusBar style="light" />
          {!ready ? (
            <View style={{ flex: 1, backgroundColor: colors.bg }} />
          ) : dbError ? (
            <StorageError message={dbError} />
          ) : (
            <>
              <StartupTasks />
              <Navigator />
            </>
          )}
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
