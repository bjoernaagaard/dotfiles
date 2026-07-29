---
name: dspy-adaptors
description: "DSPy adapters are a crucial component of the DSPy framework that handle the conversion between DSPy's structured format and the specific input/output formats expected by different language models. Think of them as translators that bridge DSPy's high-level programming interface with the low-level LM APIs."
---

# DSPy Adapters: Complete Guide

DSPy adapters are a crucial component of the DSPy framework that handle the conversion between DSPy's structured format and the specific input/output formats expected by different language models. Think of them as translators that bridge DSPy's high-level programming interface with the low-level LM APIs.

## Core Concept

Adapters solve a fundamental problem: different language models expect different input formats and return different output formats. DSPy abstracts this complexity by allowing you to work with structured `Signature` objects while adapters handle the translation behind the scenes.

## Architecture Overview

### Base Adapter Class

All adapters inherit from the `Adapter` base class, which provides:

1. **Core Methods**:
   - `format()`: Converts DSPy inputs to LM messages
   - `parse()`: Converts LM responses back to DSPy outputs
   - `__call__()` / `acall()`: Orchestrates the full flow (sync/async)

2. **Template Methods** (must be implemented by subclasses):
   - `format_field_description()`: Describes input/output fields
   - `format_field_structure()`: Defines expected format structure
   - `format_task_description()`: Explains the task objective
   - `format_user_message_content()`: Formats user messages
   - `format_assistant_message_content()`: Formats assistant responses

3. **Helper Methods**:
   - `format_demos()`: Handles few-shot examples
   - `format_conversation_history()`: Manages chat history
   - Tool calling support and preprocessing/postprocessing

## Available Adapter Types

### 1. ChatAdapter

The **ChatAdapter** uses a marker-based format with `[[ ## field_name ## ]]` delimiters:

```python
import dspy


class MySignature(dspy.Signature):
    question: str = dspy.InputField()
    answer: str = dspy.OutputField()


# ChatAdapter formats like this:
"""
[[ ## question ## ]]
What is the capital of France?

[[ ## answer ## ]]
Paris

[[ ## completed ## ]]
"""
```

**Key Features**:
- Human-readable format
- Clear field separation
- Automatic fallback to JSONAdapter on errors
- Supports conversation history via `dspy.History`

### 2. JSONAdapter

The **JSONAdapter** enforces JSON-structured outputs:

```python
# JSONAdapter formats assistant responses as:
{"answer": "Paris"}
```

**Key Features**:
- Inherits from ChatAdapter for input formatting
- Uses JSON for assistant responses
- Supports OpenAI's Structured Outputs
- Better for complex nested data structures
- Native function calling support by default

### 3. TwoStepAdapter

The **TwoStepAdapter** is designed for reasoning models that struggle with structured outputs:

```python
import dspy

# Main LM (reasoning model like o3-mini)
main_lm = dspy.LM("openai/o3-mini", max_tokens=10000)

# Extraction LM (efficient model for structured extraction)
extraction_lm = dspy.LM("openai/gpt-4o-mini")

adapter = dspy.TwoStepAdapter(extraction_lm)
dspy.configure(lm=main_lm, adapter=adapter)

program = dspy.ChainOfThought("question->answer")
result = program("What is the capital of France?")
```

**How it works**:
1. **Step 1**: Main LM gets a simple, natural prompt and generates free-form text
2. **Step 2**: Extraction LM uses ChatAdapter to extract structured data from the raw response

**Key Features**:
- Perfect for reasoning models (o3, o1, etc.)
- Separates reasoning from structured extraction
- Uses two different LMs optimized for different tasks

### 4. XMLAdapter

The **XMLAdapter** uses XML tags instead of JSON or markers:

```python
# XMLAdapter formats like:
"""
<answer>
Paris
</answer>
<completed>
"""
```

**Key Features**:
- XML-based field formatting
- Inherits from ChatAdapter
- Alternative to marker-based format

## Custom Types System

DSPy adapters support rich custom types that extend beyond simple strings and numbers:

### Built-in Types

```python
import dspy


# Image support
class VisionSignature(dspy.Signature):
    image: dspy.Image = dspy.InputField()
    description: str = dspy.OutputField()


# Usage
image = dspy.Image.from_file("photo.jpg")
# or
image = dspy.Image.from_url("https://example.com/image.jpg")


# Audio support
class AudioSignature(dspy.Signature):
    audio: dspy.Audio = dspy.InputField()
    transcript: str = dspy.OutputField()


# Code support
class CodeSignature(dspy.Signature):
    problem: str = dspy.InputField()
    code: dspy.Code["python"] = dspy.OutputField()


# Tool calling
class ToolSignature(dspy.Signature):
    tools: list[dspy.Tool] = dspy.InputField()
    query: str = dspy.InputField()
    tool_calls: dspy.ToolCalls = dspy.OutputField()


# Conversation history
class ChatSignature(dspy.Signature):
    question: str = dspy.InputField()
    history: dspy.History = dspy.InputField()
    answer: str = dspy.OutputField()
```

### Tool Integration

DSPy provides excellent tool calling support:

```python
# Define a tool
def search_web(query: str) -> str:
    """Search the web for information."""
    # implementation
    return "search results"


tool = dspy.Tool(search_web)


# Use in signature
class ToolUseSignature(dspy.Signature):
    tools: list[dspy.Tool] = dspy.InputField()
    question: str = dspy.InputField()
    tool_calls: dspy.ToolCalls = dspy.OutputField()
    answer: str = dspy.OutputField()


# The adapter handles tool calling automatically
```

## Adapter Configuration

### Setting Adapters

```python
import dspy

# Configure specific adapter
dspy.configure(lm=dspy.LM("openai/gpt-4"), adapter=dspy.JSONAdapter())

# Or use TwoStepAdapter for reasoning models
dspy.configure(
    lm=dspy.LM("openai/o3-mini"),
    adapter=dspy.TwoStepAdapter(dspy.LM("openai/gpt-4o-mini")),
)
```

### Adapter-Specific Options

```python
# JSONAdapter with custom options
json_adapter = dspy.JSONAdapter(
    callbacks=[my_callback], use_native_function_calling=True
)

# Base Adapter with callbacks
base_adapter = dspy.Adapter(
    callbacks=[logging_callback], use_native_function_calling=False
)
```

## Advanced Features

### Fallback Mechanisms

ChatAdapter automatically falls back to JSONAdapter on errors:

```python
# If ChatAdapter fails (e.g., context window exceeded),
# it automatically retries with JSONAdapter
try:
    result = chat_adapter(lm, lm_kwargs, signature, demos, inputs)
except ContextWindowExceededError:
    result = JSONAdapter()(lm, lm_kwargs, signature, demos, inputs)
```

### Conversation History

```python
import dspy


class ChatSignature(dspy.Signature):
    question: str = dspy.InputField()
    history: dspy.History = dspy.InputField()
    answer: str = dspy.OutputField()


# Build conversation history
history = dspy.History(
    messages=[
        {"question": "What is 2+2?", "answer": "4"},
        {"question": "What about 3+3?", "answer": "6"},
    ]
)

predict = dspy.Predict(ChatSignature)
result = predict(question="What about 4+4?", history=history)
```

### Structured Outputs

JSONAdapter automatically uses OpenAI's Structured Outputs when available:

```python
from typing import List
from pydantic import BaseModel


class Person(BaseModel):
    name: str
    age: int


class StructuredSignature(dspy.Signature):
    text: str = dspy.InputField()
    people: List[Person] = dspy.OutputField()


# JSONAdapter will use structured outputs for guaranteed schema compliance
```

## Best Practices

### 1. Choose the Right Adapter

- **ChatAdapter**: Default choice, human-readable, good for most use cases
- **JSONAdapter**: When you need strict JSON compliance or complex nested structures
- **TwoStepAdapter**: For reasoning models (o3, o1) that struggle with structured outputs
- **XMLAdapter**: When XML format is preferred over markers or JSON

### 2. Error Handling

```python
from dspy.utils.exceptions import AdapterParseError

try:
    result = program(input_data)
except AdapterParseError as e:
    print(f"Adapter: {e.adapter_name}")
    print(f"Raw LM response: {e.lm_response}")
    print(f"Parsed result: {e.parsed_result}")
```

### 3. Custom Adapters

You can create custom adapters by inheriting from the base `Adapter` class:

```python
class MyCustomAdapter(dspy.Adapter):
    def format_field_description(self, signature):
        # Custom field description logic
        pass
    
    def format_field_structure(self, signature):
        # Custom structure formatting
        pass
    
    def format_task_description(self, signature):
        # Custom task description
        pass
    
    def format_user_message_content(self, signature, inputs, **kwargs):
        # Custom user message formatting
        pass
    
    def format_assistant_message_content(self, signature, outputs, **kwargs):
        # Custom assistant message formatting
        pass
    
    def parse(self, signature, completion):
        # Custom parsing logic
        pass
```

## Real-World Example

Here's how adapters work in your LiftAI v3 system:

```python
# From your main.py - you're using ReAct with tools
class DataAnalysisModule(dspy.Module):
    def __init__(self):
        super().__init__()
        self.react = dspy.ReAct(
            DataAnalysisSig,
            tools=[
                generate_sql,
                execute_sql_query,
                analyze_data,
                # ... more tools
            ],
            max_iters=8,
        )


# The adapter automatically handles:
# 1. Converting tools to proper format for the LM
# 2. Parsing tool calls from LM responses
# 3. Managing the ReAct conversation flow
# 4. Handling structured data extraction
```

## Conclusion

DSPy adapters are the bridge between your high-level DSPy programs and the underlying language models. They handle:

- **Input formatting**: Converting DSPy signatures to LM prompts
- **Output parsing**: Converting LM responses back to structured data
- **Tool integration**: Managing function calling capabilities
- **Error handling**: Providing fallbacks and robust parsing
- **Custom types**: Supporting rich media and structured data

By understanding adapters, you can better debug issues, optimize performance, and even create custom adapters for specialized use cases. The adapter system is what makes DSPy's "programming not prompting" philosophy possible by abstracting away the complexity of different LM interfaces.