'use client'

// 인라인 항목 추가 행 — 폼 상태를 로컬로 격리해 타이핑 시 보드 전체 리렌더(IME 버벅임) 방지
import { useState } from 'react'
import Button from '@/app/components/ui/Button'
import { Input, Select } from '@/app/components/ui/Input'
import SearchSelect from './SearchSelect'
import { WEEKLY_BIZ_TYPES, type WeeklyMastersResponse } from '@/lib/weekly'

export interface AddItemForm {
  title: string
  bizType: string
  hospitalCode: string
  ownerTeamId: string // '' = 미지정, 숫자 문자열
  ownerId: string
  targetDate: string
}

interface Props {
  masters: WeeklyMastersResponse | null
  busy: boolean
  onSave: (form: AddItemForm) => void
  onCancel: () => void
}

export default function AddItemRow({ masters, busy, onSave, onCancel }: Props) {
  const [title, setTitle] = useState('')
  const [bizType, setBizType] = useState('공통')
  const [hospitalCode, setHospitalCode] = useState('')
  const [ownerTeamId, setOwnerTeamId] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [targetDate, setTargetDate] = useState('')

  const submit = () => {
    if (busy) return
    if (!title.trim()) {
      alert('제목을 입력하세요.')
      return
    }
    onSave({ title: title.trim(), bizType, hospitalCode, ownerTeamId, ownerId, targetDate })
  }

  // <tr>이 아닌 <div> — 테이블의 overflow-x-auto 래퍼 안에 두면 SearchSelect 드롭다운이
  // 세로 클리핑되어 선택 불가 (overflow-x 지정 시 overflow-y도 auto로 강제됨). 래퍼 밖에서 렌더할 것.
  return (
    <div className="border-t border-border bg-primary/5 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            className="w-64 flex-1"
            placeholder="제목 (필수)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return // 한글 IME 조합 확정 Enter 무시
              if (e.key === 'Enter') submit()
            }}
          />
          <Select className="w-28" value={bizType} onChange={(e) => setBizType(e.target.value)} aria-label="업무구분">
            {WEEKLY_BIZ_TYPES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
          <SearchSelect
            className="w-56"
            value={hospitalCode}
            onChange={setHospitalCode}
            options={(masters?.hospitals ?? []).map((h) => ({ value: h.hospitalCode, label: h.hospitalName }))}
            placeholder="병원 검색 (선택)"
            emptyLabel="— 병원 미지정 —"
          />
          <Select className="w-32" value={ownerTeamId} onChange={(e) => setOwnerTeamId(e.target.value)}>
            <option value="">담당 팀 (선택)</option>
            {(masters?.teams ?? []).map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.name}
              </option>
            ))}
          </Select>
          <Select className="w-32" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">담당 (선택)</option>
            {(masters?.users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            목표일
            <Input type="date" className="w-36" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </label>
          <Button size="sm" onClick={submit} disabled={busy}>
            저장
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            취소
          </Button>
        </div>
    </div>
  )
}
