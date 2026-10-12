import { useRef, useState, type FormEvent } from 'react'

type Task = {
  id: number
  title: string
  completed: boolean
}

export default function App() {
  const [title, setTitle] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const nextId = useRef(1)

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return
    const id = nextId.current++

    setTasks((current) => [
      ...current,
      { id, title: trimmedTitle, completed: false },
    ])
    setTitle('')
  }

  function toggleTask(id: number) {
    setTasks((current) =>
      current.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task,
      ),
    )
  }

  const completedCount = tasks.filter((task) => task.completed).length

  return (
    <main>
      <h1>Task list</h1>
      <p className="intro">Keep track of what needs doing.</p>

      <form onSubmit={addTask}>
        <label htmlFor="task-title">New task</label>
        <div className="add-row">
          <input
            id="task-title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What needs to be done?"
          />
          <button type="submit" disabled={!title.trim()}>
            Add task
          </button>
        </div>
      </form>

      <section aria-labelledby="tasks-heading">
        <div className="list-heading">
          <h2 id="tasks-heading">Tasks</h2>
          <span>{completedCount} of {tasks.length} complete</span>
        </div>
        {tasks.length === 0 ? (
          <p className="empty-state">No tasks yet. Add one above to get started.</p>
        ) : (
          <ul>
            {tasks.map((task) => (
              <li key={task.id}>
                <label className={task.completed ? 'task completed' : 'task'}>
                  <input
                    type="checkbox"
                    checked={task.completed}
                    onChange={() => toggleTask(task.id)}
                  />
                  <span>{task.title}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
