from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker


class Database:
    def __init__(self, url: str):
        sqlite = url.startswith("sqlite:")
        self.engine = create_engine(
            url, connect_args={"check_same_thread": False, "timeout": 15} if sqlite else {}
        )
        if sqlite:

            @event.listens_for(self.engine, "connect")
            def configure_sqlite(connection, _):
                connection.execute("PRAGMA foreign_keys=ON")
                connection.execute("PRAGMA journal_mode=WAL")

        self.session = sessionmaker(self.engine, expire_on_commit=False)
