import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { useT } from '@/hooks/useT';
import { colors } from '@/ui/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface IconProps {
  color: ColorValue;
  size: number;
  focused: boolean;
}

function TabIcon({ name, active, color, size, focused }: IconProps & { name: IconName; active: IconName }) {
  return <Ionicons name={focused ? active : name} size={size} color={color} />;
}

export default function TabsLayout() {
  const { t } = useT();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), headerTitle: t('home.title'), tabBarIcon: (p: IconProps) => <TabIcon {...p} name="home-outline" active="home" /> }} />
      <Tabs.Screen name="matches" options={{ title: t('tabs.matches'), tabBarIcon: (p: IconProps) => <TabIcon {...p} name="football-outline" active="football" /> }} />
      <Tabs.Screen name="analysis" options={{ title: t('tabs.analysis'), headerTitle: t('analysis.title'), tabBarIcon: (p: IconProps) => <TabIcon {...p} name="stats-chart-outline" active="stats-chart" /> }} />
      <Tabs.Screen name="saved" options={{ title: t('tabs.saved'), tabBarIcon: (p: IconProps) => <TabIcon {...p} name="bookmark-outline" active="bookmark" /> }} />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings'), tabBarIcon: (p: IconProps) => <TabIcon {...p} name="settings-outline" active="settings" /> }} />
    </Tabs>
  );
}
