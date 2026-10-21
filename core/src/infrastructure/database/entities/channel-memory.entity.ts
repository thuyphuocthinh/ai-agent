import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Lưu trữ các thực thể / fact ổn định vừa được tạo thành công
// trong 1 hội thoại (conversationId), đọc lại làm gợi ý ngữ cảnh cho SupervisorService.plan().
@Entity('conversation_memory')
export class ChannelMemoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'conversation_id' })
  @Index()
  conversationId: string;

  // Message sinh ra hành động này — dùng làm khoá dedupe cùng `content`
  @Column({ type: 'uuid', name: 'source_message_id' })
  sourceMessageId: string;

  @Column({ type: 'varchar' })
  tool: string;

  // "<tool>: <resultPreview>", đã cắt theo CHANNEL_MEMORY_CONTENT_MAX_CHARS.
  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  // Alias tương thích ngược
  get channelId(): string {
    return this.conversationId;
  }
  set channelId(value: string) {
    this.conversationId = value;
  }
}

export { ChannelMemoryEntity as ConversationMemoryEntity };
