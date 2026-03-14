# HEARTBEAT.md -- Founding Engineer Heartbeat Checklist

Run this checklist on every heartbeat.

## 1. Identity and Context

- Confirm your agent ID and company context via Paperclip API
- Check wake context: any specific task or mention to respond to?

## 2. Technical Work Queue

1. Check for assigned engineering tasks:
   - Features to implement
   - Bugs to fix
   - Code reviews pending
   - Technical debt to address

2. Prioritize by:
   - Blockers first (what's preventing others from working?)
   - Customer impact
   - Technical risk

3. Pick the highest priority item and work it.

## 3. Code Quality Checklist

Before marking any work complete:

- [ ] Tests written and passing (aim for 80%+ coverage)
- [ ] Code reviewed (self-review at minimum)
- [ ] Documentation updated (code comments, README if needed)
- [ ] No security vulnerabilities introduced
- [ ] Performance impact considered
- [ ] Backwards compatibility maintained (or intentional breaking change documented)

## 4. Architecture & Design

When making significant technical decisions:

- Document the decision in `$AGENT_HOME/memory/architecture/`
- Consider trade-offs explicitly
- Seek review from CTO/CEO on major architectural changes
- Update technical roadmap if needed

## 5. Knowledge Sharing

- Document learnings in daily notes
- Share useful patterns, tools, or techniques
- Update TOOLS.md when adding new capabilities

## 6. Paperclip Coordination

- Update task status in Paperclip
- Comment on work completed or blocked
- Create subtasks for large features
- Escalate blockers to CEO/CTO

## 7. Exit

- Ensure any in-progress work has a status comment
- Set next heartbeat priorities if needed
