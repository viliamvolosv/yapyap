// StorageModule: thin wrapper over DatabaseManager

import type { YapYapNodeOptions } from "../core/node";
import { ContactsDatabase } from "../database/domains/ContactsDatabase";
import { MessageQueueDatabase } from "../database/domains/MessageQueueDatabase";
import { NodeKeysDatabase } from "../database/domains/NodeKeysDatabase";
import { PeerMetadataDatabase } from "../database/domains/PeerMetadataDatabase";
import { RoutingCacheDatabase } from "../database/domains/RoutingCacheDatabase";
import { SearchDatabase } from "../database/domains/SearchDatabase";
import { SessionDatabase } from "../database/domains/SessionDatabase";
import { DatabaseManager } from "../database/index";

export class StorageModule {
	private dbManager: DatabaseManager;
	private contactsDb!: ContactsDatabase;
	private messageQueueDb!: MessageQueueDatabase;
	private routingCacheDb!: RoutingCacheDatabase;
	private sessionDb!: SessionDatabase;
	private nodeKeysDb!: NodeKeysDatabase;
	private peerMetadataDb!: PeerMetadataDatabase;
	private searchDb!: SearchDatabase;

	constructor(options: YapYapNodeOptions) {
		this.dbManager = new DatabaseManager(options);
		const db = this.dbManager.getDatabase();
		this.contactsDb = new ContactsDatabase(db);
		this.messageQueueDb = new MessageQueueDatabase(db);
		this.routingCacheDb = new RoutingCacheDatabase(db);
		this.sessionDb = new SessionDatabase(db);
		this.nodeKeysDb = new NodeKeysDatabase(db);
		this.peerMetadataDb = new PeerMetadataDatabase(db);
		this.searchDb = new SearchDatabase(db);
	}

	async close() {
		await this.dbManager.close();
	}

	// High-level accessors
	get contacts() {
		return this.contactsDb;
	}
	get messages() {
		return this.messageQueueDb;
	}
	get routing() {
		return this.routingCacheDb;
	}
	get sessions() {
		return this.sessionDb;
	}
	get keys() {
		return this.nodeKeysDb;
	}
	get metadata() {
		return this.peerMetadataDb;
	}
	get search() {
		return this.searchDb;
	}
	get manager() {
		return this.dbManager;
	}
}
