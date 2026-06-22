# Project: AI-Native Database Client

## Vision

Build the first AI-native database client that understands a database's structure, relationships, and business concepts instead of acting as a traditional SQL editor with an AI chat window attached.

The product should feel to database work what Cursor became for software development.

Users should be able to explore, query, understand, and modify databases through natural language while maintaining the control, transparency, and safety expected by professional engineers.

---

# Problem Statement

Current database tools are optimized around SQL.

Examples:

- TablePlus
- DataGrip
- DBeaver
- SSMS

These tools assume users understand:

- Table structures
- Foreign key relationships
- Domain concepts
- SQL syntax

AI integrations added to these products are often shallow:

- Chat sidebars
- SQL generation
- Query explanations

They do not fundamentally understand the database being queried.

As databases become larger and more complex, engineers spend increasing amounts of time answering questions such as:

- Which table contains this data?
- How are these entities related?
- Which joins should I use?
- Is this query safe?
- What does this legacy schema actually represent?

The opportunity is to make the database itself understandable.

---

# Core Hypothesis

Developers do not want AI-generated SQL.

Developers want answers.

SQL is often just the implementation detail required to obtain those answers.

Example:

Instead of:

"Write a query joining customers, orders and payments."

Users want:

"Show customers who spent more than £1,000 this quarter."

The system should:

1. Understand the schema.
2. Understand relationships.
3. Generate SQL.
4. Explain the SQL.
5. Execute safely.
6. Present results.

---

# Product Principles

## AI First

AI is the primary interface, not an add-on.

## Transparency

Generated SQL is always visible.

Users can inspect and modify queries before execution.

## Safety

Potentially destructive operations must be detected and reviewed.

## Local First

Database credentials remain local.

Users can choose:

- OpenAI
- Anthropic
- Gemini
- Azure OpenAI
- Local models

## Multi Database

Support:

- PostgreSQL
- SQL Server
- MySQL
- MariaDB
- SQLite

before considering niche databases.

---

# Architecture

## Layer 1: Database Connectivity

Responsibilities:

- Connections
- Query execution
- Metadata retrieval
- Schema introspection

Potential technologies:

- node-postgres
- mssql
- mysql2

---

## Layer 2: Schema Intelligence Engine

Responsibilities:

- Discover tables
- Discover columns
- Discover foreign keys
- Discover indexes
- Build relationship graph

Output:

Knowledge graph representing the database.

Example:

Customer
├── Orders
│ └── OrderItems
└── Addresses

This becomes the source of truth for AI interactions.

---

## Layer 3: AI Context Engine

Responsibilities:

- Schema summarization
- Relationship summaries
- Context compression
- Embeddings
- Retrieval

Purpose:

Avoid sending entire schemas to the LLM.

Only send relevant context.

---

## Layer 4: AI Agent

Capabilities:

### Query Generation

"Find users inactive for 90 days."

### Schema Explanation

"What is the difference between Customer and CustomerProfile?"

### Query Optimization

"Can this query be improved?"

### Data Discovery

"Where is payment status stored?"

### Migration Assistance

"Generate a migration to add audit tracking."

---

## Layer 5: Desktop Client

Potential stack:

- Tauri
- React
- TypeScript
- Monaco Editor

Reasons:

- Small footprint
- Cross platform
- Familiar frontend ecosystem

---

# MVP

Version 1 should not attempt to replace DataGrip.

Focus on proving the core hypothesis.

Features:

## Database Explorer

- Tables
- Columns
- Relationships

## SQL Editor

- Execute queries
- Results grid

## AI Chat

- Natural language to SQL
- Explain schema
- Explain queries

## Relationship Visualization

- Interactive graph

## Query Review

- Generated SQL preview
- User approval required

---

# Differentiators

Compared to TablePlus:

- Deep schema understanding
- AI-native workflows

Compared to DataGrip:

- Simpler experience
- AI-first interface

Compared to ChatGPT:

- Direct database awareness
- Persistent schema knowledge
- Query execution

---

# Security Model

Principles:

- Credentials never leave device.
- AI providers never receive result sets unless explicitly allowed.
- Schema sharing is configurable.
- Support local LLM execution.

Potential modes:

### Local Only

No external communication.

### Schema Sharing

Schema sent to LLM.

No data sent.

### Full AI

Schema and sampled data sent to provider.

User opt-in required.

---

# Validation Questions

Before building:

1. Do engineers actually want natural language database interaction?
2. How accurate can schema understanding become?
3. Which workflows consume the most time today?
4. Would users switch from TablePlus?
5. Would teams pay for this?

---

# First Technical Experiment

Build a prototype that:

1. Connects to PostgreSQL.
2. Introspects schema.
3. Builds relationship graph.
4. Answers questions about the schema.
5. Generates correct SQL.

Success Criteria:

- AI correctly identifies tables.
- AI correctly identifies joins.
- AI explains relationships accurately.
- Generated queries execute successfully.

Only after validating these assumptions should a full client be developed.
