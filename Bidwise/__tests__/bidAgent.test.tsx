import React from 'react';
import ReactTestRenderer, { ReactTestInstance, ReactTestRenderer as Renderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AgentChatPreview, ChatComposer, ChatMessages, useChatSend } from '../src/components/project/AgentChat';
import { BidAgentProvider, useBidAgent } from '../src/data/bidAgent';
import { ThemeProvider } from '../src/theme';

// The Bid Agent chat on the demo data: suggestions send a request, the answer shows
// what the agent did (a table, saved files, checklist rows).

jest.useFakeTimers();

const textIn = (n: ReactTestInstance) =>
  n
    .findAll(c => (c.type as unknown) === 'Text')
    .map(c => [c.props.children].flat().join(''))
    .join(' ');

jest.mock('../src/platform/share', () => ({ share: { shareText: jest.fn(() => Promise.resolve()) } }));

function Harness({ onOpen }: { onOpen: (f: { file_id: number; name: string }) => void }) {
  const chat = useBidAgent().useChat('GMRC/MMI-2');
  const sender = useChatSend(chat);
  return (
    <>
      <AgentChatPreview chat={chat} onOpen={() => {}} />
      <ChatMessages chat={chat} onOpenFile={onOpen} onPick={sender.send} />
      <ChatComposer chat={chat} sender={sender} />
    </>
  );
}

async function mount(onOpen = jest.fn()) {
  let r!: Renderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}
      >
        <ThemeProvider>
          <BidAgentProvider mode="demo">
            <Harness onOpen={onOpen} />
          </BidAgentProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return r;
}

const press = async (r: Renderer, text: string) => {
  const hit = r.root
    .findAll(n => typeof n.type !== 'string' && typeof n.props.onPress === 'function' && textIn(n).includes(text))
    .pop();
  if (!hit) throw new Error(`nothing to press with ${text}`);
  await ReactTestRenderer.act(async () => {
    hit.props.onPress();
    jest.advanceTimersByTime(1000);
  });
};

// Types a request into the message box and sends it.
const ask = async (r: Renderer, text: string) => {
  const input = r.root.find(n => n.props.accessibilityLabel === 'Message the Bid Agent' && typeof n.props.onChangeText === 'function');
  await ReactTestRenderer.act(async () => input.props.onChangeText(text));
  const send = r.root.find(n => n.props.accessibilityLabel === 'Send' && typeof n.props.onPress === 'function');
  await ReactTestRenderer.act(async () => {
    send.props.onPress();
    jest.advanceTimersByTime(1000);
  });
};

const placeholder = (r: Renderer) =>
  r.root.find(n => n.props.accessibilityLabel === 'Message the Bid Agent' && typeof n.props.onChangeText === 'function').props
    .placeholder;

describe('bid agent chat', () => {
  it('starts with suggestions and does what is asked', async () => {
    const onOpen = jest.fn();
    const r = await mount(onOpen);
    // empty chat: the suggestions, centred (no instructions text); the box cycles them
    expect(textIn(r.root)).toContain('Show the prequalification');
    expect(textIn(r.root)).toContain('Prepare the documents checklist');
    expect(textIn(r.root)).not.toContain('Ask in your own words');
    expect(placeholder(r)).toBe('Show the prequalification');
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(3600);
    });
    expect(placeholder(r)).toBe('Save the prequal as Excel');

    await press(r, 'Show the prequalification');
    let out = textIn(r.root);
    expect(out).toContain('Prequalification criteria');
    expect(out).toContain('3.4  Average annual turnover');
    expect(out).toContain('INR 190 Cr over the last 5 years');
    expect(out).toContain('Requirement:');

    // the suggestions leave the chat once it has started; ask through the box
    expect(textIn(r.root)).not.toContain('Extract all tender forms');
    await ask(r, 'Save the prequal as Excel');
    out = textIn(r.root);
    expect(out).toContain('Saved to Docs for Preparation');
    await press(r, 'Prequalification - GMRC_MMI-2_SURAT_PH-1_2026.xlsx');
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ name: 'Prequalification - GMRC_MMI-2_SURAT_PH-1_2026.xlsx' }));

    await ask(r, 'Prepare the documents checklist');
    out = textIn(r.root);
    expect(out).toContain('Added to Ready for Bid');
    expect(out).toContain('Attached: ELI-1.1 - Bidder Information Form.docx');
    expect(out).toContain('Pending: file to be attached');

    // copy: answers and tables open the share sheet (Copy), text is selectable
    const { share } = require('../src/platform/share');
    await press(r, 'Copy table');
    expect(share.shareText).toHaveBeenCalledWith(expect.stringContaining('Ref\tCriterion\tRequirement'));
    const selectable = r.root.findAll(n => (n.type as unknown) === 'Text' && n.props.selectable === true);
    expect(selectable.length).toBeGreaterThan(5);
    expect(out).toContain('7 rows added');
  });

  it('the one-line box cycles the suggestions and opens the chat', async () => {
    const onOpen = jest.fn();
    function Box() {
      return <AgentChatPreview chat={useBidAgent().useChat('GMRC/MMI-2')} onOpen={onOpen} />;
    }
    let r!: Renderer;
    await ReactTestRenderer.act(async () => {
      r = ReactTestRenderer.create(
        <ThemeProvider>
          <BidAgentProvider mode="demo">
            <Box />
          </BidAgentProvider>
        </ThemeProvider>,
      );
    });
    const box = () => r.root.find(n => n.props.accessibilityLabel === 'Ask the Bid Agent' && typeof n.props.onPress === 'function');
    expect(textIn(r.root)).toContain('Show the prequalification');
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(3600);
    });
    expect(textIn(r.root)).toContain('Save the prequal as Excel');

    // tap: the chat with its suggestions; the "ask" action (as a swipe): that request typed in
    await ReactTestRenderer.act(async () => box().props.onPress());
    expect(onOpen).toHaveBeenLastCalledWith();
    await ReactTestRenderer.act(async () => box().props.onAccessibilityAction({ nativeEvent: { actionName: 'ask' } }));
    expect(onOpen).toHaveBeenLastCalledWith('Save the prequal as Excel');
  });
});
