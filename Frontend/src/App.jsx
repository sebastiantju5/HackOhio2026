import { useState } from 'react'
import SignIn from './SignIn.jsx'
import TripPlanner from './TripPlanner.jsx'

export default function App() {
  const [account, setAccount] = useState(false)
  if (account) return <><button className="back-to-planner" onClick={() => setAccount(false)}>← Back to trip planner</button><SignIn /></>
  return <TripPlanner onAccount={() => setAccount(true)} />
}
