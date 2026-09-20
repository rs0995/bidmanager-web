import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, {
  ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  ProgressRing,
  SegmentedControl,
  StatusChip,
  Toggle,
} from '../src/components/ui';
import { ThemeProvider } from '../src/theme';

async function mount(node: React.ReactElement) {
  let r!: Renderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return r;
}

describe('UI kit', () => {
  it('Button fires onPress and blocks while loading', async () => {
    const onPress = jest.fn();
    const r = await mount(<Button label="Save" onPress={onPress} />);
    r.root.findByProps({ accessibilityRole: 'button' }).props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);

    const r2 = await mount(<Button label="Save" onPress={onPress} loading />);
    expect(
      r2.root.findByProps({ accessibilityRole: 'button' }).props.disabled,
    ).toBe(true);
  });

  it('Chip and SegmentedControl report selection', async () => {
    const onChip = jest.fn();
    const chip = await mount(<Chip label="eProcure" onPress={onChip} />);
    chip.root.findByProps({ accessibilityRole: 'button' }).props.onPress();
    expect(onChip).toHaveBeenCalled();

    const onSeg = jest.fn();
    const seg = await mount(
      <SegmentedControl
        options={[
          { key: 'a', label: 'Tenders' },
          { key: 'b', label: 'Organisations' },
        ]}
        value="a"
        onChange={onSeg}
      />,
    );
    const tabs = seg.root
      .findAllByProps({ accessibilityRole: 'tab' })
      .filter(n => typeof n.props.onPress === 'function');
    tabs[1].props.onPress();
    expect(onSeg).toHaveBeenCalledWith('b');
  });

  it('Toggle flips its value', async () => {
    const onChange = jest.fn();
    const r = await mount(
      <Toggle
        value={false}
        onValueChange={onChange}
        accessibilityLabel="Reminders"
      />,
    );
    r.root.findByProps({ accessibilityRole: 'switch' }).props.onPress();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Field shows an error message', async () => {
    const r = await mount(<Field label="Email" error="Enter a valid email" />);
    expect(JSON.stringify(r.toJSON())).toContain('Enter a valid email');
  });

  it('renders display components in solid and glass without crashing', async () => {
    await mount(
      <Card>
        <Text>x</Text>
        <StatusChip tone="ok" label="7d" />
        <ProgressRing size={60} progress={0.4} />
        <EmptyState title="Nothing yet" />
        <ErrorState onRetry={() => {}} />
      </Card>,
    );
  });
});
