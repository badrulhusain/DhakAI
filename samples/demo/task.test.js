import assert from 'node:assert/strict';
import test from 'node:test';
import { createTask } from './task.js';

test('creates a task with its title', () => {
  assert.deepEqual(createTask('Review the diff'), { title: 'Review the diff' });
});
