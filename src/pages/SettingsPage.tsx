import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { loadSettings, saveSettings, getModelsForProvider } from '@/lib/settings';
import { AppSettings } from '@/types/layout';
import Logo from '@/components/Logo';

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const navigate = useNavigate();
  const { toast } = useToast();

  const models = getModelsForProvider(settings.provider);
  const isOpenRouter = settings.provider === 'openrouter';
  const useCustomApiKey = Boolean(settings.useCustomApiKey);

  const handleSave = () => {
    saveSettings(settings);
    toast({ title: 'Settings saved. You\'re good to go.' });
  };

  return (
    <div className="min-h-screen bg-background">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Logo className="text-lg" />
        <Button variant="ghost" size="sm" className="rounded-xl text-muted-foreground hover:text-foreground" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
      </nav>

      <main className="max-w-md mx-auto py-12 px-6">
        <h1 className="font-heading text-2xl font-bold text-foreground mb-2">Settings</h1>
        <p className="text-muted-foreground text-sm font-light mb-8">Tweak how Unfographic talks to the AI.</p>

        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="custom-api-toggle" className="text-foreground">Use your own API key</Label>
                <p className="text-xs text-muted-foreground font-light">Off by default — the app uses its own backend keys.</p>
              </div>
              <Switch
                id="custom-api-toggle"
                checked={useCustomApiKey}
                onCheckedChange={(checked) => setSettings((s) => ({ ...s, useCustomApiKey: checked }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">AI Provider</Label>
            <Select
              value={settings.provider}
              onValueChange={(v) =>
                setSettings((s) => ({
                  ...s,
                  provider: v as AppSettings['provider'],
                  model: v === 'openai' ? 'gpt-4o' : v === 'anthropic' ? 'claude-sonnet-4-20250514' : '',
                }))
              }
              disabled={!useCustomApiKey}
            >
              <SelectTrigger className="rounded-xl bg-background border-input text-foreground focus:border-primary focus:ring-primary/20"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
              </SelectContent>
            </Select>
            {!useCustomApiKey && <p className="text-xs text-muted-foreground font-light">Using the app's default provider.</p>}
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">API Key</Label>
            <Input
              type="password"
              placeholder="sk-..."
              value={settings.apiKey}
              disabled={!useCustomApiKey}
              className="rounded-xl bg-background border-input text-foreground focus:border-primary focus:ring-primary/20"
              onChange={(e) => setSettings((s) => ({ ...s, apiKey: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground font-light">Stored locally. Only used when custom key mode is on.</p>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">Model</Label>
            {isOpenRouter ? (
              <Input
                placeholder="e.g. google/gemini-pro-vision"
                value={settings.model}
                disabled={!useCustomApiKey}
                className="rounded-xl bg-background border-input text-foreground focus:border-primary focus:ring-primary/20"
                onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
              />
            ) : (
              <Select
                value={settings.model}
                onValueChange={(v) => setSettings((s) => ({ ...s, model: v }))}
                disabled={!useCustomApiKey}
              >
                <SelectTrigger className="rounded-xl bg-background border-input text-foreground focus:border-primary focus:ring-primary/20"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">Default Slide Size</Label>
            <Select
              value={settings.slideSize}
              onValueChange={(v) => setSettings((s) => ({ ...s, slideSize: v as '16:9' | '4:3' }))}
            >
              <SelectTrigger className="rounded-xl bg-background border-input text-foreground focus:border-primary focus:ring-primary/20"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="16:9">16:9 (Widescreen)</SelectItem>
                <SelectItem value="4:3">4:3 (Standard)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleSave} className="w-full rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg shadow-primary/30 hover:shadow-primary/50">
            <Save className="h-4 w-4 mr-2" /> Save Settings
          </Button>
        </div>
      </main>
    </div>
  );
}
