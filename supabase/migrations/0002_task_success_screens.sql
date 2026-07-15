-- Task auto-completion: declare per-task goal screens on the demo study.
--
-- The mobile runtime auto-completes a task (Maze-style) when the prototype
-- reaches any screen id in the task's `successScreenIds`. The participant no
-- longer taps "I completed the task"; only "I give up" stays manual. Tasks
-- without `successScreenIds` (e.g. open-ended "explore") keep the manual path.
--
-- Idempotent: re-running rewrites the same tasks array.

update test_links
set bootstrap = jsonb_set(
  bootstrap,
  '{tasks}',
  $json$
  [
    {
      "id": "task_browse",
      "title": "Find a product you like",
      "instruction": "Browse the shop and open the product that looks most interesting to you.",
      "required": true,
      "successScreenIds": ["detail"]
    },
    {
      "id": "task_checkout",
      "title": "Buy the product",
      "instruction": "Add the product to your cart and complete the checkout.",
      "required": true,
      "successScreenIds": ["done"]
    }
  ]
  $json$::jsonb
)
where token = 'DEMO123';
