"""
Test script to verify if xAI realtime model actually invokes function tools.
Run: python test_xai_tools.py
"""
import asyncio
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

from livekit.agents import function_tool, RunContext
from livekit.plugins import xai

# Track if tool was called
tool_was_called = False

@function_tool()
async def say_hello(context: RunContext, name: str) -> str:
    """Says hello to a person by name. You MUST call this tool when asked to greet someone."""
    global tool_was_called
    tool_was_called = True
    print(f"\n>>> TOOL ACTUALLY CALLED! name={name}\n")
    return f"Said hello to {name}"


async def test_tool_calling():
    global tool_was_called

    print("Creating xAI realtime model...")
    model = xai.realtime.RealtimeModel(voice="Ara")

    print("Creating session...")
    session = model.session(
        tools=[say_hello],
        instructions="You have a tool called say_hello. When asked to greet someone, you MUST use this tool. Do not just say hello - actually call the tool."
    )

    print("Connecting session...")
    async with session:
        print("Session connected. Sending message to trigger tool...")

        # Send a message that should trigger the tool
        await session.conversation.item.create(
            type="message",
            role="user",
            content=[{"type": "input_text", "text": "Please use the say_hello tool to greet John."}]
        )

        # Request a response
        await session.response.create()

        # Wait for response and tool call
        print("Waiting for response...")
        await asyncio.sleep(10)  # Give it time to respond

    print(f"\n=== RESULT ===")
    print(f"Tool was called: {tool_was_called}")
    if not tool_was_called:
        print("PROBLEM: xAI realtime model did NOT invoke the tool!")
    else:
        print("SUCCESS: Tool was invoked!")


if __name__ == "__main__":
    print(f"XAI_API_KEY set: {bool(os.getenv('XAI_API_KEY'))}")
    asyncio.run(test_tool_calling())
